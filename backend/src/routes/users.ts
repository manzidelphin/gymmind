import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { resolveGym } from '../middleware/gym.middleware';
import { requireRole } from '../middleware/role.middleware';
import { normalizePhone, validatePhone } from '../utils/phone';

const router = Router();

// All user routes: resolve gym first, then verify JWT, then check role
router.use(resolveGym, authenticate, requireRole('gym_owner', 'gym_manager'));

// ---------------------------------------------------------------
// GET /api/users
// Paginated member list with optional filters.
// Always scoped to req.gym.id.
// ---------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const gymId = req.gym.id;
  const page    = Math.max(1, parseInt(req.query.page   as string) || 1);
  const limit   = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset  = (page - 1) * limit;

  const search        = (req.query.search        as string) || '';
  const institutionId = req.query.institutionId  as string | undefined;
  const status        = req.query.status         as string | undefined;
  const role          = req.query.role           as string | undefined;

  // Build WHERE conditions — gym_id and role = 'member' are always fixed
  const conditions: string[] = ["u.gym_id = ?", "u.role = 'member'"];
  const params: unknown[]    = [gymId];

  if (search) {
    conditions.push('(u.name LIKE ? OR u.phone LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (institutionId) {
    conditions.push('u.institution_id = ?');
    params.push(parseInt(institutionId));
  }
  if (status) {
    conditions.push('u.status = ?');
    params.push(status);
  }
  if (role) {
    conditions.push('u.role = ?');
    params.push(role);
  }

  const where = conditions.join(' AND ');

  const [rows] = await pool.query<any[]>(
    `SELECT u.*,
            mp.name     AS active_plan_name,
            mp.type     AS active_plan_type,
            um.status   AS membership_status,
            um.end_date,
            um.remaining_sessions,
            i.name      AS institution_name,
            parent.name AS parent_name
     FROM users u
     LEFT JOIN user_memberships um
           ON um.user_id = u.id AND um.gym_id = ? AND um.status = 'active'
     LEFT JOIN membership_plans mp ON mp.id = um.plan_id AND mp.gym_id = ?
     LEFT JOIN institutions i ON i.id = u.institution_id AND i.gym_id = ?
     LEFT JOIN users parent ON parent.id = u.parent_id AND parent.gym_id = u.gym_id
     WHERE ${where}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [gymId, gymId, gymId, ...params, limit, offset]
  );

  const [[{ total }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM users u WHERE ${where}`,
    params
  );

  res.json({ data: rows, total, page, limit });
});

// ---------------------------------------------------------------
// GET /api/users/:id
// Full member detail: institution, active membership, last 10 check-ins.
// Always WHERE gym_id = req.gym.id.
// ---------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  const gymId  = req.gym.id;
  const userId = parseInt(req.params.id);

  const [userRows] = await pool.query<any[]>(
    `SELECT u.*, i.name AS institution_name
     FROM users u
     LEFT JOIN institutions i ON i.id = u.institution_id AND i.gym_id = ?
     WHERE u.id = ? AND u.gym_id = ?`,
    [gymId, userId, gymId]
  );

  if (!userRows[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const [membershipRows] = await pool.query<any[]>(
    `SELECT um.*, mp.name AS plan_name, mp.type
     FROM user_memberships um
     JOIN membership_plans mp ON mp.id = um.plan_id AND mp.gym_id = ?
     WHERE um.user_id = ? AND um.gym_id = ? AND um.status = 'active'
     LIMIT 1`,
    [gymId, userId, gymId]
  );

  const [checkinRows] = await pool.query<any[]>(
    `SELECT checked_in_at, checkin_type
     FROM checkins
     WHERE user_id = ? AND gym_id = ?
     ORDER BY checked_in_at DESC
     LIMIT 10`,
    [userId, gymId]
  );

  res.json({
    user: userRows[0],
    membership: membershipRows[0] ?? null,
    recentCheckins: checkinRows,
  });
});

// ---------------------------------------------------------------
// POST /api/users
// Create a new member at this gym.
// gym_id always from req.gym.id — never from body.
// ---------------------------------------------------------------
const createUserSchema = z.object({
  name:          z.string().min(1).max(255),
  phone:         z.string().min(9).optional(),
  role:          z.enum(['gym_owner', 'gym_manager', 'member']).optional().default('member'),
  institutionId: z.number().int().positive().optional(),
});

router.post('/', async (req: Request, res: Response) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId = req.gym.id;
  let phone: string | null = null;
  if (parsed.data.phone) {
    try {
      phone = normalizePhone(parsed.data.phone);
      if (!validatePhone(phone)) throw new Error('Invalid phone number format');
    } catch (e: any) {
      res.status(400).json({ error: e.message });
      return;
    }
  }
  const status = phone ? 'active' : 'unclaimed';

  // Validate institutionId belongs to this gym
  if (parsed.data.institutionId !== undefined) {
    const [instRows] = await pool.query<any[]>(
      'SELECT id FROM institutions WHERE id = ? AND gym_id = ?',
      [parsed.data.institutionId, gymId]
    );
    if (!instRows[0]) {
      res.status(400).json({ error: 'Institution not found at this gym' });
      return;
    }
  }

  const [result] = await pool.query<any>(
    `INSERT INTO users (gym_id, name, phone, role, institution_id, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [gymId, parsed.data.name, phone, parsed.data.role, parsed.data.institutionId ?? null, status]
  );

  const [newRows] = await pool.query<any[]>(
    'SELECT * FROM users WHERE id = ?',
    [result.insertId]
  );

  res.status(201).json(newRows[0]);
});

// ---------------------------------------------------------------
// PATCH /api/users/:id
// Update name, status, or institutionId.
// WHERE gym_id = req.gym.id enforces tenant isolation.
// ---------------------------------------------------------------
const updateUserSchema = z.object({
  name:          z.string().min(1).max(255).optional(),
  phone:         z.string().min(9).optional(),
  status:        z.enum(['active', 'suspended', 'pending', 'unclaimed']).optional(),
  institutionId: z.number().int().positive().nullable().optional(),
});

router.patch('/:id', async (req: Request, res: Response) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId  = req.gym.id;
  const userId = parseInt(req.params.id);

  // Confirm user exists at this gym
  const [existing] = await pool.query<any[]>(
    'SELECT id FROM users WHERE id = ? AND gym_id = ?',
    [userId, gymId]
  );
  if (!existing[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Validate institutionId belongs to this gym if provided
  if (parsed.data.institutionId !== undefined && parsed.data.institutionId !== null) {
    const [instRows] = await pool.query<any[]>(
      'SELECT id FROM institutions WHERE id = ? AND gym_id = ?',
      [parsed.data.institutionId, gymId]
    );
    if (!instRows[0]) {
      res.status(400).json({ error: 'Institution not found at this gym' });
      return;
    }
  }

  // Normalize and validate phone if provided
  let normalizedPhone: string | undefined;
  if (parsed.data.phone !== undefined) {
    try {
      normalizedPhone = normalizePhone(parsed.data.phone);
      if (!validatePhone(normalizedPhone)) throw new Error('Invalid phone number format');
    } catch (e: any) {
      res.status(400).json({ error: e.message });
      return;
    }
    const [dupRows] = await pool.query<any[]>(
      'SELECT id FROM users WHERE gym_id = ? AND phone = ? AND id != ?',
      [gymId, normalizedPhone, userId]
    );
    if (dupRows[0]) {
      res.status(409).json({ error: 'Phone already registered at this gym' });
      return;
    }
  }

  const updates: string[]  = [];
  const params:  unknown[] = [];

  if (parsed.data.name !== undefined) {
    updates.push('name = ?');
    params.push(parsed.data.name);
  }
  if (normalizedPhone !== undefined) {
    updates.push('phone = ?');
    params.push(normalizedPhone);
  }
  if (parsed.data.status !== undefined) {
    updates.push('status = ?');
    params.push(parsed.data.status);
  }
  if (parsed.data.institutionId !== undefined) {
    updates.push('institution_id = ?');
    params.push(parsed.data.institutionId);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  // gym_id in WHERE is the security guarantee — can never update another gym's user
  await pool.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ? AND gym_id = ?`,
    [...params, userId, gymId]
  );

  const [updated] = await pool.query<any[]>(
    'SELECT * FROM users WHERE id = ?',
    [userId]
  );

  res.json(updated[0]);
});

// ---------------------------------------------------------------
// POST /api/users/:id/membership
// Cancel any existing active membership and assign a new plan.
// Verifies the plan belongs to this gym before assigning.
// ---------------------------------------------------------------
const assignMembershipSchema = z.object({
  planId:    z.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
});

router.post('/:id/membership', async (req: Request, res: Response) => {
  const parsed = assignMembershipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId  = req.gym.id;
  const userId = parseInt(req.params.id);

  // Confirm the member belongs to this gym
  const [userRows] = await pool.query<any[]>(
    'SELECT id FROM users WHERE id = ? AND gym_id = ?',
    [userId, gymId]
  );
  if (!userRows[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Confirm the plan belongs to this gym — prevents cross-gym plan assignment
  const [planRows] = await pool.query<any[]>(
    'SELECT * FROM membership_plans WHERE id = ? AND gym_id = ? AND is_active = true',
    [parsed.data.planId, gymId]
  );
  if (!planRows[0]) {
    res.status(404).json({ error: 'Plan not found at this gym' });
    return;
  }

  const plan = planRows[0];
  const startDate = parsed.data.startDate;

  // Calculate end_date and initial session count based on plan type
  let endDate: string | null = null;
  let remainingSessions: number | null = null;

  if (plan.type === 'time_based') {
    const end = new Date(startDate);
    end.setDate(end.getDate() + plan.duration_days);
    endDate = end.toISOString().slice(0, 10);
  } else if (plan.type === 'session_based') {
    remainingSessions = plan.sessions;
  }

  // Cancel any existing active membership for this user at this gym
  await pool.query(
    `UPDATE user_memberships SET status = 'cancelled'
     WHERE user_id = ? AND gym_id = ? AND status = 'active'`,
    [userId, gymId]
  );

  // Create the new membership
  const [result] = await pool.query<any>(
    `INSERT INTO user_memberships
       (gym_id, user_id, plan_id, start_date, end_date, remaining_sessions, status, assigned_by)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    [gymId, userId, plan.id, startDate, endDate, remainingSessions, req.user.id]
  );

  const [newMembership] = await pool.query<any[]>(
    `SELECT um.*, mp.name AS plan_name
     FROM user_memberships um
     JOIN membership_plans mp ON mp.id = um.plan_id
     WHERE um.id = ?`,
    [result.insertId]
  );

  res.status(201).json(newMembership[0]);
});

// ---------------------------------------------------------------
// POST /api/users/import
// Bulk-create members from a parsed CSV payload.
// Body: { members: [{ name, phone?, institutionName? }] }
// Returns: { created, skipped, errors }
// ---------------------------------------------------------------
const importSchema = z.object({
  members: z.array(z.object({
    name:            z.string().min(1).max(255),
    phone:           z.string().optional(),
    institutionName: z.string().optional(),
  })).min(1).max(500),
});

router.post('/import', async (req: Request, res: Response) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId = req.gym.id;
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Pre-load institutions for this gym once
  const [instRows] = await pool.query<any[]>(
    'SELECT id, name FROM institutions WHERE gym_id = ?',
    [gymId]
  );
  const institutionMap = new Map<string, number>(
    instRows.map(r => [r.name.toLowerCase().trim(), r.id])
  );

  for (const member of parsed.data.members) {
    try {
      let phone: string | null = null;
      if (member.phone?.trim()) {
        try {
          phone = normalizePhone(member.phone.trim());
          if (!validatePhone(phone)) throw new Error('Invalid phone number format');
        } catch {
          skipped++;
          errors.push(`${member.name}: invalid phone number format`);
          continue;
        }
      }

      // Skip if phone already in use at this gym
      if (phone) {
        const [dup] = await pool.query<any[]>(
          'SELECT id FROM users WHERE gym_id = ? AND phone = ?',
          [gymId, phone]
        );
        if (dup[0]) {
          skipped++;
          errors.push(`${member.name}: phone ${phone} already registered`);
          continue;
        }
      }

      // Resolve institution by name (case-insensitive, optional)
      const institutionId = member.institutionName?.trim()
        ? (institutionMap.get(member.institutionName.trim().toLowerCase()) ?? null)
        : null;

      if (member.institutionName?.trim() && institutionId === null) {
        errors.push(`${member.name}: institution "${member.institutionName}" not found — created without institution`);
      }

      const status = phone ? 'active' : 'unclaimed';
      await pool.query(
        `INSERT INTO users (gym_id, name, phone, role, institution_id, status)
         VALUES (?, ?, ?, 'member', ?, ?)`,
        [gymId, member.name.trim(), phone, institutionId, status]
      );
      created++;
    } catch {
      errors.push(`${member.name}: failed to create`);
    }
  }

  res.json({ created, skipped, errors });
});

export default router;
