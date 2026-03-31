import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { resolveGym } from '../middleware/gym.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

// ---------------------------------------------------------------
// GET /api/institutions/public
// Public: list institutions for this gym (no auth required).
// ---------------------------------------------------------------
router.get('/public', resolveGym, async (req: Request, res: Response) => {
  const gymId = req.gym.id;
  const [rows] = await pool.query<any[]>(
    `SELECT id, name FROM institutions WHERE gym_id = ? ORDER BY name ASC`,
    [gymId]
  );
  res.json(rows);
});

// ---------------------------------------------------------------
// GET /api/institutions/:id/members/unclaimed
// Public: list unclaimed members for an institution.
// ---------------------------------------------------------------
router.get('/:id/members/unclaimed', resolveGym, async (req: Request, res: Response) => {
  const gymId = req.gym.id;
  const instId = parseInt(req.params.id);

  const [instRows] = await pool.query<any[]>(
    'SELECT id FROM institutions WHERE id = ? AND gym_id = ?',
    [instId, gymId]
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.name, u.parent_id, p.name AS parent_name
     FROM users u
     LEFT JOIN users p ON p.id = u.parent_id AND p.gym_id = u.gym_id
     WHERE u.gym_id = ? AND u.institution_id = ? AND u.status = 'unclaimed' AND u.role = 'member'
     ORDER BY u.parent_id IS NOT NULL, u.name ASC`,
    [gymId, instId]
  );

  res.json(rows);
});

router.use(resolveGym, authenticate);

// ---------------------------------------------------------------
// GET /api/institutions
// List all institutions for this gym.
// ---------------------------------------------------------------
router.get('/', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const gymId = req.gym.id;

  const [rows] = await pool.query<any[]>(
    `SELECT i.*,
            COUNT(DISTINCT CASE WHEN u.parent_id IS NULL AND u.role = 'member' THEN u.id END) AS employee_count,
            COUNT(DISTINCT CASE WHEN u.role = 'member' THEN u.id END) AS member_count
     FROM institutions i
     LEFT JOIN users u ON u.institution_id = i.id AND u.gym_id = ?
     WHERE i.gym_id = ?
     GROUP BY i.id
     ORDER BY i.name ASC`,
    [gymId, gymId]
  );

  const [adminRows] = await pool.query<any[]>(
    `SELECT id, name, phone, email, institution_id
     FROM users
     WHERE gym_id = ? AND role = 'institution_admin'
     ORDER BY name ASC`,
    [gymId],
  );

  const adminsByInst: Record<number, { id: number; name: string; phone: string | null; email: string | null }[]> = {};
  for (const admin of adminRows) {
    if (!adminsByInst[admin.institution_id]) adminsByInst[admin.institution_id] = [];
    adminsByInst[admin.institution_id].push({ id: admin.id, name: admin.name, phone: admin.phone ?? null, email: admin.email ?? null });
  }

  res.json(rows.map((r: any) => ({ ...r, hr_admins: adminsByInst[r.id] ?? [] })));
});

// ---------------------------------------------------------------
// POST /api/institutions
// Create a new institution for this gym.
// ---------------------------------------------------------------
const createInstitutionSchema = z.object({
  name:               z.string().min(1).max(255),
  allows_dependents:  z.boolean().default(false),
  rate_per_session:   z.number().min(0).default(0),
});

router.post('/', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const parsed = createInstitutionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId = req.gym.id;

  const [result] = await pool.query<any>(
    `INSERT INTO institutions (gym_id, name, allows_dependents, rate_per_session)
     VALUES (?, ?, ?, ?)`,
    [gymId, parsed.data.name, parsed.data.allows_dependents, parsed.data.rate_per_session]
  );

  const [newInst] = await pool.query<any[]>(
    'SELECT * FROM institutions WHERE id = ?',
    [result.insertId]
  );

  res.status(201).json(newInst[0]);
});

// ---------------------------------------------------------------
// PATCH /api/institutions/:id
// Update name, allows_dependents, or rate_per_session.
// ---------------------------------------------------------------
const updateInstitutionSchema = z.object({
  name:              z.string().min(1).max(255).optional(),
  allows_dependents: z.boolean().optional(),
  rate_per_session:  z.number().min(0).optional(),
});

router.patch('/:id', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const parsed = updateInstitutionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId = req.gym.id;
  const instId = parseInt(req.params.id);

  const [existing] = await pool.query<any[]>(
    'SELECT id FROM institutions WHERE id = ? AND gym_id = ?',
    [instId, gymId]
  );
  if (!existing[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  const updates: string[]  = [];
  const params:  unknown[] = [];

  if (parsed.data.name !== undefined) {
    updates.push('name = ?'); params.push(parsed.data.name);
  }
  if (parsed.data.allows_dependents !== undefined) {
    updates.push('allows_dependents = ?'); params.push(parsed.data.allows_dependents);
  }
  if (parsed.data.rate_per_session !== undefined) {
    updates.push('rate_per_session = ?'); params.push(parsed.data.rate_per_session);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  await pool.query(
    `UPDATE institutions SET ${updates.join(', ')} WHERE id = ? AND gym_id = ?`,
    [...params, instId, gymId]
  );

  const [updated] = await pool.query<any[]>(
    'SELECT * FROM institutions WHERE id = ?',
    [instId]
  );

  res.json(updated[0]);
});

// ---------------------------------------------------------------
// POST /api/institutions/:id/upload-members
// Upload employees + dependents for an institution in one shot.
// Body: { employees: [{ name, phone?, dependents?: [{ name }] }] }
// Returns: { created, skipped, errors }
// ---------------------------------------------------------------
const uploadMembersSchema = z.object({
  employees: z.array(z.object({
    name:       z.string().min(1).max(255),
    phone:      z.string().optional(),
    dependents: z.array(z.object({
      name: z.string().min(1).max(255),
    })).optional().default([]),
  })).min(1).max(200),
});

import { normalizePhone, validatePhone } from '../utils/phone';

// ---------------------------------------------------------------
// POST /api/institutions/:id/invite-admin
// Creates (or updates) an institution_admin user for this institution
// and sends them an SMS with their portal URL.
// ---------------------------------------------------------------
const inviteAdminSchema = z.object({
  adminName:  z.string().min(1).max(255),
  adminPhone: z.string().min(9),
});

router.post('/:id/invite-admin', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const parsed = inviteAdminSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  let phone: string;
  try {
    phone = normalizePhone(parsed.data.adminPhone);
    if (!validatePhone(phone)) throw new Error('Invalid phone number format');
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  const gymId  = req.gym.id;
  const instId = parseInt(req.params.id);

  // Confirm institution belongs to this gym
  const [instRows] = await pool.query<any[]>(
    'SELECT id, name, slug FROM institutions WHERE id = ? AND gym_id = ?',
    [instId, gymId]
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  const inst = instRows[0];

  // Generate slug if not already set
  let slug: string = inst.slug;
  if (!slug) {
    slug = inst.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    // Ensure uniqueness by appending inst ID if collision
    const [slugCheck] = await pool.query<any[]>(
      'SELECT id FROM institutions WHERE slug = ? AND id != ?',
      [slug, instId]
    );
    if (slugCheck[0]) slug = `${slug}-${instId}`;
  }

  // Check if institution_admin already exists for this institution
  const [existing] = await pool.query<any[]>(
    `SELECT id FROM users
     WHERE gym_id = ? AND institution_id = ? AND role = 'institution_admin'
     LIMIT 1`,
    [gymId, instId]
  );

  if (existing[0]) {
    // Update existing admin
    await pool.query(
      `UPDATE users SET name = ?, phone = ?, status = 'active'
       WHERE id = ? AND gym_id = ?`,
      [parsed.data.adminName, phone, existing[0].id, gymId]
    );
  } else {
    // Create new admin — check phone not already in use at this gym
    const [dupRows] = await pool.query<any[]>(
      'SELECT id FROM users WHERE gym_id = ? AND phone = ?',
      [gymId, phone]
    );
    if (dupRows[0]) {
      res.status(409).json({ error: 'This phone number is already registered at this gym' });
      return;
    }
    await pool.query(
      `INSERT INTO users (gym_id, name, phone, role, status, institution_id)
       VALUES (?, ?, ?, 'institution_admin', 'active', ?)`,
      [gymId, parsed.data.adminName, phone, instId]
    );
  }

  // Update institution with slug, admin info
  await pool.query(
    `UPDATE institutions SET slug = ?, admin_phone = ?, admin_name = ?
     WHERE id = ? AND gym_id = ?`,
    [slug, phone, parsed.data.adminName, instId, gymId]
  );

  res.json({
    message:   'Institution admin invited',
    portalUrl: `/institution/${slug}`,
    slug,
  });
});

router.post('/:id/upload-members', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const parsed = uploadMembersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId  = req.gym.id;
  const instId = parseInt(req.params.id);

  // Confirm institution belongs to this gym
  const [instRows] = await pool.query<any[]>(
    'SELECT id, allows_dependents FROM institutions WHERE id = ? AND gym_id = ?',
    [instId, gymId]
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  const allowsDependents: boolean = instRows[0].allows_dependents;

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const emp of parsed.data.employees) {
    try {
      const phone = emp.phone?.trim() ? normalizePhone(emp.phone.trim()) : null;

      // Skip if phone already registered at this gym
      if (phone) {
        const [dup] = await pool.query<any[]>(
          'SELECT id FROM users WHERE gym_id = ? AND phone = ?',
          [gymId, phone]
        );
        if (dup[0]) {
          skipped++;
          errors.push(`${emp.name}: phone ${phone} already registered`);
          continue;
        }
      }

      const status = phone ? 'active' : 'unclaimed';

      const [empResult] = await pool.query<any>(
        `INSERT INTO users (gym_id, name, phone, role, institution_id, parent_id, status)
         VALUES (?, ?, ?, 'member', ?, NULL, ?)`,
        [gymId, emp.name.trim(), phone, instId, status]
      );
      const empId: number = empResult.insertId;
      created++;

      // Insert dependents if institution allows it
      if (allowsDependents && emp.dependents && emp.dependents.length > 0) {
        for (const dep of emp.dependents) {
          try {
            await pool.query(
              `INSERT INTO users (gym_id, name, phone, role, institution_id, parent_id, status)
               VALUES (?, ?, NULL, 'member', ?, ?, 'unclaimed')`,
              [gymId, dep.name.trim(), instId, empId]
            );
            created++;
          } catch {
            errors.push(`${dep.name} (dependent of ${emp.name}): failed to create`);
          }
        }
      } else if (!allowsDependents && emp.dependents && emp.dependents.length > 0) {
        errors.push(`${emp.name}: institution does not allow dependents — dependents skipped`);
      }
    } catch {
      errors.push(`${emp.name}: failed to create`);
    }
  }

  res.json({ created, skipped, errors });
});

// ---------------------------------------------------------------
// GET /api/institutions/:id/services
// Returns services configured for this institution.
// ---------------------------------------------------------------
router.get('/:id/services', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const gymId  = req.gym.id;
  const instId = parseInt(req.params.id);

  const [instRows] = await pool.query<any[]>(
    'SELECT id FROM institutions WHERE id = ? AND gym_id = ?',
    [instId, gymId]
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  const [rows] = await pool.query<any[]>(
    `SELECT s.id, s.name, s.description, s.price_per_visit, ist.allowed_for
     FROM institution_services ist
     JOIN services s ON ist.service_id = s.id
     WHERE ist.institution_id = ? AND ist.gym_id = ?
     ORDER BY s.name ASC`,
    [instId, gymId]
  );

  res.json(rows);
});

// ---------------------------------------------------------------
// PATCH /api/institutions/:id/services
// Replace service access config for this institution.
// Body: { services: Array<{ serviceId, allowedFor }> }
// ---------------------------------------------------------------
const institutionServicesSchema = z.object({
  services: z.array(z.object({
    serviceId:  z.number().int().positive(),
    allowedFor: z.enum(['employees', 'dependents', 'both']),
  })),
});

router.patch('/:id/services', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const parsed = institutionServicesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId  = req.gym.id;
  const instId = parseInt(req.params.id);

  const [instRows] = await pool.query<any[]>(
    'SELECT id FROM institutions WHERE id = ? AND gym_id = ?',
    [instId, gymId]
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  // Delete existing and re-insert
  await pool.query(
    'DELETE FROM institution_services WHERE institution_id = ? AND gym_id = ?',
    [instId, gymId]
  );

  for (const svc of parsed.data.services) {
    const [svcRows] = await pool.query<any[]>(
      'SELECT id FROM services WHERE id = ? AND gym_id = ? AND is_active = true',
      [svc.serviceId, gymId]
    );
    if (svcRows[0]) {
      await pool.query(
        `INSERT INTO institution_services (institution_id, service_id, gym_id, allowed_for)
         VALUES (?, ?, ?, ?)`,
        [instId, svc.serviceId, gymId, svc.allowedFor]
      );
    }
  }

  res.json({ success: true });
});

// ---------------------------------------------------------------
// POST /api/institutions/:id/hr-admins
// Add an HR admin to an institution.
// ---------------------------------------------------------------
const hrAdminSchema = z.object({
  name:  z.string().min(1).max(255),
  phone: z.string().min(9),
  email: z.string().email().optional(),
});

router.post('/:id/hr-admins', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const parsed = hrAdminSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  let phone: string;
  try {
    phone = normalizePhone(parsed.data.phone);
    if (!validatePhone(phone)) throw new Error('Invalid phone number format');
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  const gymId  = req.gym.id;
  const instId = parseInt(req.params.id);

  const [instRows] = await pool.query<any[]>(
    'SELECT id FROM institutions WHERE id = ? AND gym_id = ?',
    [instId, gymId],
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  const [dupRows] = await pool.query<any[]>(
    'SELECT id FROM users WHERE gym_id = ? AND phone = ?',
    [gymId, phone],
  );
  if (dupRows[0]) {
    res.status(409).json({ error: 'This phone number is already registered at this gym' });
    return;
  }

  const [result] = await pool.query<any>(
    `INSERT INTO users (gym_id, name, phone, email, role, status, institution_id)
     VALUES (?, ?, ?, ?, 'institution_admin', 'active', ?)`,
    [gymId, parsed.data.name, phone, parsed.data.email ?? null, instId],
  );

  const [[newAdmin]] = await pool.query<any[]>(
    'SELECT id, name, phone, email, institution_id FROM users WHERE id = ?',
    [result.insertId],
  );

  res.status(201).json(newAdmin);
});

export default router;
