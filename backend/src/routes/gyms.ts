/**
 * SUPER ADMIN ROUTES — /api/admin/*
 *
 * No X-Gym-Slug header. No resolveGym middleware.
 * Requires super_admin role only.
 *
 * ---------------------------------------------------------------
 * CURL TEST COMMANDS
 * ---------------------------------------------------------------
 *
 * 1. Get super_admin token (phone set in seed.sql):
 *    OTP=$(curl -s -X POST http://localhost:3002/api/auth/send-otp \
 *      -H "Content-Type: application/json" \
 *      -H "X-Gym-Slug: kigali-fitness" \
 *      -d '{"phone": "+250700000000"}')
 *    NOTE: super_admin OTP still needs a gym slug for the OTP endpoint.
 *    For admin login, use any gym slug to get the OTP, then use the token
 *    on /api/admin/* routes without a gym slug.
 *
 * 2. List all gyms:
 *    curl http://localhost:3002/api/admin/gyms \
 *      -H "Authorization: Bearer <super_admin_token>"
 *
 * 3. Create a gym:
 *    curl -X POST http://localhost:3002/api/admin/gyms \
 *      -H "Content-Type: application/json" \
 *      -H "Authorization: Bearer <super_admin_token>" \
 *      -d '{"name":"Musanze Gym","slug":"musanze-gym","subscription_plan":"trial"}'
 *
 * 4. Platform stats:
 *    curl http://localhost:3002/api/admin/stats \
 *      -H "Authorization: Bearer <super_admin_token>"
 * ---------------------------------------------------------------
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

// Super admin routes: authenticate JWT, then enforce super_admin role.
// resolveGym is intentionally NOT used — super_admin spans all gyms.
router.use(authenticate, requireRole('super_admin'));

// ---------------------------------------------------------------
// GET /api/admin/gyms
// All gyms with member count and last check-in timestamp.
// ---------------------------------------------------------------
router.get('/gyms', async (_req: Request, res: Response) => {
  const [rows] = await pool.query<any[]>(
    `SELECT
       g.*,
       COUNT(DISTINCT u.id)  AS member_count,
       MAX(c.checked_in_at)  AS last_checkin_at
     FROM gyms g
     LEFT JOIN users u ON u.gym_id = g.id AND u.role = 'member'
     LEFT JOIN checkins c ON c.gym_id = g.id
     GROUP BY g.id
     ORDER BY g.created_at DESC`
  );

  res.json(rows);
});

// ---------------------------------------------------------------
// POST /api/admin/gyms
// Create a new tenant gym.
// ---------------------------------------------------------------
const createGymSchema = z.object({
  name:              z.string().min(1).max(255),
  slug:              z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers and hyphens only'),
  phone:             z.string().optional(),
  address:           z.string().optional(),
  subscription_plan: z.enum(['trial', 'basic', 'pro', 'enterprise']).default('trial'),
  trial_ends_at:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post('/gyms', async (req: Request, res: Response) => {
  const parsed = createGymSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  // Check slug uniqueness
  const [existing] = await pool.query<any[]>(
    'SELECT id FROM gyms WHERE slug = ?',
    [parsed.data.slug]
  );
  if (existing[0]) {
    res.status(409).json({ error: 'A gym with this slug already exists' });
    return;
  }

  const [result] = await pool.query<any>(
    `INSERT INTO gyms (name, slug, phone, address, subscription_plan, subscription_status, trial_ends_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    [
      parsed.data.name,
      parsed.data.slug,
      parsed.data.phone        ?? null,
      parsed.data.address      ?? null,
      parsed.data.subscription_plan,
      parsed.data.trial_ends_at ?? null,
    ]
  );

  const [newGym] = await pool.query<any[]>(
    'SELECT * FROM gyms WHERE id = ?',
    [result.insertId]
  );

  res.status(201).json(newGym[0]);
});

// ---------------------------------------------------------------
// PATCH /api/admin/gyms/:id
// Update subscription plan, status, or trial end date.
// ---------------------------------------------------------------
const updateGymSchema = z.object({
  subscription_plan:   z.enum(['trial', 'basic', 'pro', 'enterprise']).optional(),
  subscription_status: z.enum(['active', 'suspended', 'cancelled']).optional(),
  trial_ends_at:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  name:                z.string().min(1).max(255).optional(),
  phone:               z.string().optional(),
  address:             z.string().optional(),
});

router.patch('/gyms/:id', async (req: Request, res: Response) => {
  const parsed = updateGymSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId = parseInt(req.params.id);

  const [existing] = await pool.query<any[]>(
    'SELECT id FROM gyms WHERE id = ?',
    [gymId]
  );
  if (!existing[0]) {
    res.status(404).json({ error: 'Gym not found' });
    return;
  }

  const updates: string[]  = [];
  const params:  unknown[] = [];

  if (parsed.data.name                !== undefined) { updates.push('name = ?');                params.push(parsed.data.name); }
  if (parsed.data.phone               !== undefined) { updates.push('phone = ?');               params.push(parsed.data.phone); }
  if (parsed.data.address             !== undefined) { updates.push('address = ?');             params.push(parsed.data.address); }
  if (parsed.data.subscription_plan   !== undefined) { updates.push('subscription_plan = ?');   params.push(parsed.data.subscription_plan); }
  if (parsed.data.subscription_status !== undefined) { updates.push('subscription_status = ?'); params.push(parsed.data.subscription_status); }
  if (parsed.data.trial_ends_at       !== undefined) { updates.push('trial_ends_at = ?');       params.push(parsed.data.trial_ends_at); }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  await pool.query(
    `UPDATE gyms SET ${updates.join(', ')} WHERE id = ?`,
    [...params, gymId]
  );

  const [updated] = await pool.query<any[]>(
    'SELECT * FROM gyms WHERE id = ?',
    [gymId]
  );

  res.json(updated[0]);
});

// ---------------------------------------------------------------
// GET /api/admin/stats
// Platform-wide totals — all gyms combined.
// ---------------------------------------------------------------
router.get('/stats', async (_req: Request, res: Response) => {
  const [[{ total_gyms }]] = await pool.query<any[]>(
    'SELECT COUNT(*) AS total_gyms FROM gyms'
  );

  const [[{ total_members }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total_members FROM users WHERE role = 'member'`
  );

  const [[{ checkins_today }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS checkins_today
     FROM checkins
     WHERE DATE(checked_in_at) = CURDATE()`
  );

  res.json({
    total_gyms:    Number(total_gyms),
    total_members: Number(total_members),
    checkins_today: Number(checkins_today),
  });
});

export default router;
