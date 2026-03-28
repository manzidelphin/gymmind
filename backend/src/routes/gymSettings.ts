import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { resolveGym } from '../middleware/gym.middleware';
import { requireRole } from '../middleware/role.middleware';
import { normalizePhone } from '../utils/phone';

const router = Router();
router.use(resolveGym, authenticate);

const SAFE_COLS = 'id, name, slug, phone, address, subscription_plan, momo_number, momo_api_user_id';

// ---------------------------------------------------------------
// GET /api/gyms/me
// ---------------------------------------------------------------
router.get('/me', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const [rows] = await pool.query<any[]>(
    `SELECT ${SAFE_COLS} FROM gyms WHERE id = ?`,
    [req.gym.id],
  );
  if (!rows[0]) { res.status(404).json({ error: 'Gym not found' }); return; }
  res.json(rows[0]);
});

// ---------------------------------------------------------------
// PATCH /api/gyms/me  — gym profile
// ---------------------------------------------------------------
const profileSchema = z.object({
  name:    z.string().min(1).max(255).optional(),
  phone:   z.string().optional(),
  address: z.string().optional(),
});

router.patch('/me', requireRole('gym_owner'), async (req: Request, res: Response) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }

  const updates: string[]  = [];
  const params:  unknown[] = [];
  if (parsed.data.name    !== undefined) { updates.push('name = ?');    params.push(parsed.data.name); }
  if (parsed.data.phone   !== undefined) { updates.push('phone = ?');   params.push(parsed.data.phone); }
  if (parsed.data.address !== undefined) { updates.push('address = ?'); params.push(parsed.data.address); }

  if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  await pool.query(`UPDATE gyms SET ${updates.join(', ')} WHERE id = ?`, [...params, req.gym.id]);
  const [updated] = await pool.query<any[]>(`SELECT ${SAFE_COLS} FROM gyms WHERE id = ?`, [req.gym.id]);
  res.json(updated[0]);
});

// ---------------------------------------------------------------
// PATCH /api/gyms/me/momo  — MTN credentials
// ---------------------------------------------------------------
const momoSchema = z.object({
  momoNumber:          z.string().optional(),
  momoApiUserId:       z.string().optional(),
  momoApiKey:          z.string().optional(),
  momoSubscriptionKey: z.string().optional(),
});

router.patch('/me/momo', requireRole('gym_owner'), async (req: Request, res: Response) => {
  const parsed = momoSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }

  const updates: string[]  = [];
  const params:  unknown[] = [];
  if (parsed.data.momoNumber          !== undefined) { updates.push('momo_number = ?');           params.push(normalizePhone(parsed.data.momoNumber)); }
  if (parsed.data.momoApiUserId       !== undefined) { updates.push('momo_api_user_id = ?');       params.push(parsed.data.momoApiUserId); }
  if (parsed.data.momoApiKey          !== undefined) { updates.push('momo_api_key = ?');           params.push(parsed.data.momoApiKey); }
  if (parsed.data.momoSubscriptionKey !== undefined) { updates.push('momo_subscription_key = ?');  params.push(parsed.data.momoSubscriptionKey); }

  if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  await pool.query(`UPDATE gyms SET ${updates.join(', ')} WHERE id = ?`, [...params, req.gym.id]);
  res.json({ message: 'MoMo settings saved' });
});

export default router;
