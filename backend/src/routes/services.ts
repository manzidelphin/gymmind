import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { resolveGym } from '../middleware/gym.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

router.use(resolveGym);

// ── GET /api/services/public — no auth needed ─────────────────
router.get('/public', async (req: Request, res: Response) => {
  const gymId = req.gym.id;
  const [rows] = await pool.query<any[]>(
    `SELECT id, name, description, price_per_visit, walkin_price, currency, is_default
     FROM services
     WHERE gym_id = ? AND is_active = true
     ORDER BY is_default DESC, name ASC`,
    [gymId]
  );
  res.json(rows);
});

// All remaining routes require auth
router.use(authenticate);

// ── GET /api/services ─────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const gymId = req.gym.id;
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM services
     WHERE gym_id = ? AND is_active = true
     ORDER BY is_default DESC, name ASC`,
    [gymId]
  );
  res.json(rows);
});

// ── POST /api/services ────────────────────────────────────────
const createServiceSchema = z.object({
  name:          z.string().min(1).max(100),
  description:   z.string().max(255).optional(),
  pricePerVisit: z.number().min(0).optional().default(0),
  walkinPrice:   z.number().min(0).optional().default(0),
  isDefault:     z.boolean().optional().default(false),
});

router.post('/', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const parsed = createServiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId = req.gym.id;

  const [result] = await pool.query<any>(
    `INSERT INTO services (gym_id, name, description, price_per_visit, walkin_price, is_default, is_active)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [gymId, parsed.data.name, parsed.data.description ?? null, parsed.data.pricePerVisit, parsed.data.walkinPrice, parsed.data.isDefault]
  );

  const [newService] = await pool.query<any[]>(
    'SELECT * FROM services WHERE id = ?',
    [result.insertId]
  );

  res.status(201).json(newService[0]);
});

// ── PATCH /api/services/:id ───────────────────────────────────
const updateServiceSchema = z.object({
  name:          z.string().min(1).max(100).optional(),
  description:   z.string().max(255).optional(),
  pricePerVisit: z.number().min(0).optional(),
  walkinPrice:   z.number().min(0).optional(),
  isActive:      z.boolean().optional(),
  isDefault:     z.boolean().optional(),
});

router.patch('/:id', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const parsed = updateServiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId     = req.gym.id;
  const serviceId = parseInt(req.params.id);

  const [existing] = await pool.query<any[]>(
    'SELECT id FROM services WHERE id = ? AND gym_id = ?',
    [serviceId, gymId]
  );
  if (!existing[0]) {
    res.status(404).json({ error: 'Service not found' });
    return;
  }

  const updates: string[]  = [];
  const params:  unknown[] = [];

  if (parsed.data.name          !== undefined) { updates.push('name = ?');            params.push(parsed.data.name); }
  if (parsed.data.description   !== undefined) { updates.push('description = ?');     params.push(parsed.data.description); }
  if (parsed.data.pricePerVisit !== undefined) { updates.push('price_per_visit = ?'); params.push(parsed.data.pricePerVisit); }
  if (parsed.data.walkinPrice   !== undefined) { updates.push('walkin_price = ?');    params.push(parsed.data.walkinPrice); }
  if (parsed.data.isActive      !== undefined) { updates.push('is_active = ?');       params.push(parsed.data.isActive); }
  if (parsed.data.isDefault     !== undefined) { updates.push('is_default = ?');      params.push(parsed.data.isDefault); }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  await pool.query(
    `UPDATE services SET ${updates.join(', ')} WHERE id = ? AND gym_id = ?`,
    [...params, serviceId, gymId]
  );

  const [updated] = await pool.query<any[]>(
    'SELECT * FROM services WHERE id = ?',
    [serviceId]
  );

  res.json(updated[0]);
});

// ── DELETE /api/services/:id — soft delete ────────────────────
router.delete('/:id', requireRole('gym_owner'), async (req: Request, res: Response) => {
  const gymId     = req.gym.id;
  const serviceId = parseInt(req.params.id);

  const [existing] = await pool.query<any[]>(
    'SELECT id FROM services WHERE id = ? AND gym_id = ?',
    [serviceId, gymId]
  );
  if (!existing[0]) {
    res.status(404).json({ error: 'Service not found' });
    return;
  }

  await pool.query(
    'UPDATE services SET is_active = false WHERE id = ? AND gym_id = ?',
    [serviceId, gymId]
  );

  res.json({ success: true });
});

export default router;
