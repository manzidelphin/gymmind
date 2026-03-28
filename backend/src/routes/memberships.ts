import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { resolveGym } from '../middleware/gym.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

router.use(resolveGym, authenticate);

// ---------------------------------------------------------------
// GET /api/membership-plans
// Public to all authenticated gym users.
// Always WHERE gym_id = req.gym.id.
// ---------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const gymId = req.gym.id;

  const [plans] = await pool.query<any[]>(
    `SELECT * FROM membership_plans
     WHERE gym_id = ? AND is_active = true
     ORDER BY price ASC`,
    [gymId]
  );

  // Attach included services to each plan
  const plansWithServices = await Promise.all(
    plans.map(async (plan) => {
      const [serviceRows] = await pool.query<any[]>(
        `SELECT s.id, s.name
         FROM plan_services ps
         JOIN services s ON ps.service_id = s.id
         WHERE ps.plan_id = ? AND ps.gym_id = ?`,
        [plan.id, gymId]
      );
      return { ...plan, services: serviceRows };
    })
  );

  res.json(plansWithServices);
});

// ---------------------------------------------------------------
// POST /api/membership-plans
// Create a new plan for this gym.
// gym_id always from req.gym.id.
// ---------------------------------------------------------------
const createPlanSchema = z.object({
  name:          z.string().min(1).max(255),
  type:          z.enum(['time_based', 'session_based', 'institutional']),
  duration_days: z.number().int().positive().optional(),
  sessions:      z.number().int().positive().optional(),
  price:         z.number().positive(),
  currency:      z.string().max(10).optional().default('RWF'),
  serviceIds:    z.array(z.number().int().positive()).optional(),
}).refine(data => {
  if (data.type === 'time_based'    && !data.duration_days) return false;
  if (data.type === 'session_based' && !data.sessions)      return false;
  return true;
}, { message: 'time_based plans require duration_days; session_based plans require sessions' });

router.post('/', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const parsed = createPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const gymId = req.gym.id;

  const [result] = await pool.query<any>(
    `INSERT INTO membership_plans
       (gym_id, name, type, duration_days, sessions, price, currency, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, true)`,
    [
      gymId,
      parsed.data.name,
      parsed.data.type,
      parsed.data.duration_days ?? null,
      parsed.data.sessions      ?? null,
      parsed.data.price,
      parsed.data.currency,
    ]
  );

  const planId: number = result.insertId;

  // Link services to the plan (verify each belongs to this gym)
  if (parsed.data.serviceIds && parsed.data.serviceIds.length > 0) {
    for (const serviceId of parsed.data.serviceIds) {
      const [svcRows] = await pool.query<any[]>(
        'SELECT id FROM services WHERE id = ? AND gym_id = ? AND is_active = true',
        [serviceId, gymId]
      );
      if (svcRows[0]) {
        await pool.query(
          'INSERT IGNORE INTO plan_services (plan_id, service_id, gym_id) VALUES (?, ?, ?)',
          [planId, serviceId, gymId]
        );
      }
    }
  }

  const [newPlan] = await pool.query<any[]>(
    'SELECT * FROM membership_plans WHERE id = ?',
    [planId]
  );

  const [serviceRows] = await pool.query<any[]>(
    `SELECT s.id, s.name FROM plan_services ps
     JOIN services s ON ps.service_id = s.id
     WHERE ps.plan_id = ? AND ps.gym_id = ?`,
    [planId, gymId]
  );

  res.status(201).json({ ...newPlan[0], services: serviceRows });
});

// ---------------------------------------------------------------
// PATCH /api/membership-plans/:id
// Update plan name, price, or deactivate it.
// WHERE gym_id = req.gym.id enforces ownership.
// ---------------------------------------------------------------
const updatePlanSchema = z.object({
  name:          z.string().min(1).max(255).optional(),
  price:         z.number().positive().optional(),
  is_active:     z.boolean().optional(),
  duration_days: z.number().int().positive().optional(),
  sessions:      z.number().int().positive().optional(),
});

router.patch('/:id', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const parsed = updatePlanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId  = req.gym.id;
  const planId = parseInt(req.params.id);

  // Confirm the plan belongs to this gym
  const [existing] = await pool.query<any[]>(
    'SELECT id FROM membership_plans WHERE id = ? AND gym_id = ?',
    [planId, gymId]
  );
  if (!existing[0]) {
    res.status(404).json({ error: 'Plan not found' });
    return;
  }

  const updates: string[]  = [];
  const params:  unknown[] = [];

  if (parsed.data.name          !== undefined) { updates.push('name = ?');          params.push(parsed.data.name); }
  if (parsed.data.price         !== undefined) { updates.push('price = ?');         params.push(parsed.data.price); }
  if (parsed.data.is_active     !== undefined) { updates.push('is_active = ?');     params.push(parsed.data.is_active); }
  if (parsed.data.duration_days !== undefined) { updates.push('duration_days = ?'); params.push(parsed.data.duration_days); }
  if (parsed.data.sessions      !== undefined) { updates.push('sessions = ?');      params.push(parsed.data.sessions); }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  await pool.query(
    `UPDATE membership_plans SET ${updates.join(', ')} WHERE id = ? AND gym_id = ?`,
    [...params, planId, gymId]
  );

  const [updated] = await pool.query<any[]>(
    'SELECT * FROM membership_plans WHERE id = ?',
    [planId]
  );

  res.json(updated[0]);
});

// ---------------------------------------------------------------
// PATCH /api/membership-plans/:id/services
// Replace services linked to a plan.
// Body: { serviceIds: number[] }
// ---------------------------------------------------------------
router.patch('/:id/services', requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const gymId  = req.gym.id;
  const planId = parseInt(req.params.id);

  const parsed = z.object({
    serviceIds: z.array(z.number().int().positive()),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const [existing] = await pool.query<any[]>(
    'SELECT id FROM membership_plans WHERE id = ? AND gym_id = ?',
    [planId, gymId]
  );
  if (!existing[0]) {
    res.status(404).json({ error: 'Plan not found' });
    return;
  }

  // Delete existing and re-insert
  await pool.query(
    'DELETE FROM plan_services WHERE plan_id = ? AND gym_id = ?',
    [planId, gymId]
  );

  for (const serviceId of parsed.data.serviceIds) {
    const [svcRows] = await pool.query<any[]>(
      'SELECT id FROM services WHERE id = ? AND gym_id = ? AND is_active = true',
      [serviceId, gymId]
    );
    if (svcRows[0]) {
      await pool.query(
        'INSERT IGNORE INTO plan_services (plan_id, service_id, gym_id) VALUES (?, ?, ?)',
        [planId, serviceId, gymId]
      );
    }
  }

  const [serviceRows] = await pool.query<any[]>(
    `SELECT s.id, s.name FROM plan_services ps
     JOIN services s ON ps.service_id = s.id
     WHERE ps.plan_id = ? AND ps.gym_id = ?`,
    [planId, gymId]
  );

  res.json({ services: serviceRows });
});

export default router;
