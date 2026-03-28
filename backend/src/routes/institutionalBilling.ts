import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { resolveGym } from '../middleware/gym.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();
router.use(resolveGym, authenticate, requireRole('gym_owner', 'gym_manager'));

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM');

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------
// GET /api/billing/institutions?month=YYYY-MM
// Summary billing for all institutions for a given month.
// ---------------------------------------------------------------
router.get('/institutions', async (req: Request, res: Response) => {
  const gymId     = req.gym.id;
  const monthParam = (req.query.month as string) || currentMonth();

  const parsed = monthSchema.safeParse(monthParam);
  if (!parsed.success) {
    res.status(400).json({ error: 'month must be YYYY-MM format (e.g. 2026-03)' });
    return;
  }
  const month = parsed.data;

  const [rows] = await pool.query<any[]>(
    `SELECT
       i.id,
       i.name,
       i.rate_per_session,
       COUNT(DISTINCT CASE WHEN c.id IS NOT NULL THEN c.user_id END) AS active_members,
       COUNT(c.id)                                                    AS total_visits,
       SUM(CASE WHEN c.id IS NOT NULL THEN COALESCE(
         s.walkin_price,
         (SELECT walkin_price FROM services
          WHERE gym_id = i.gym_id AND is_default = 1 LIMIT 1),
         0
       ) END)                                                         AS calculated_amount,
       ip.id               AS payment_id,
       ip.status           AS payment_status,
       ip.paid_at,
       ip.total_amount     AS paid_amount,
       ip.payment_reference
     FROM institutions i
     LEFT JOIN users u
       ON u.institution_id = i.id AND u.gym_id = i.gym_id
     LEFT JOIN checkins c
       ON c.user_id = u.id AND c.gym_id = i.gym_id
       AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
     LEFT JOIN services s
       ON c.service_id = s.id AND s.gym_id = i.gym_id
     LEFT JOIN institutional_payments ip
       ON ip.institution_id = i.id AND ip.gym_id = i.gym_id AND ip.month = ?
     WHERE i.gym_id = ?
     GROUP BY i.id, i.name, i.rate_per_session,
              ip.id, ip.status, ip.paid_at, ip.total_amount, ip.payment_reference
     ORDER BY i.name ASC`,
    [month, month, gymId],
  );

  const institutions = rows.map((r: any) => {
    const totalVisits      = Number(r.total_visits);
    const ratePerSession   = Number(r.rate_per_session);
    const calculatedAmount = Number(r.calculated_amount) || 0;
    return {
      id:                r.id,
      name:              r.name,
      rate_per_session:  ratePerSession,
      active_members:    Number(r.active_members),
      total_visits:      totalVisits,
      calculated_amount: calculatedAmount,
      payment_id:        r.payment_id        ?? null,
      payment_status:    r.payment_status    ?? null,
      paid_at:           r.paid_at           ?? null,
      paid_amount:       r.paid_amount != null ? Number(r.paid_amount) : null,
      payment_reference: r.payment_reference ?? null,
    };
  });

  res.json({ month, institutions });
});

// ---------------------------------------------------------------
// GET /api/billing/institutions/:id/breakdown?month=YYYY-MM
// Per-member per-service visit breakdown for one institution.
// ---------------------------------------------------------------
router.get('/institutions/:id/breakdown', async (req: Request, res: Response) => {
  const gymId        = req.gym.id;
  const institutionId = parseInt(req.params.id);
  const monthParam    = (req.query.month as string) || currentMonth();

  const parsed = monthSchema.safeParse(monthParam);
  if (!parsed.success) {
    res.status(400).json({ error: 'month must be YYYY-MM format' });
    return;
  }
  const month = parsed.data;

  const [instRows] = await pool.query<any[]>(
    'SELECT id, name, rate_per_session FROM institutions WHERE id = ? AND gym_id = ?',
    [institutionId, gymId],
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  const [rows] = await pool.query<any[]>(
    `SELECT
       u.id          AS user_id,
       u.name,
       u.parent_id,
       parent.name   AS parent_name,
       s.id          AS service_id,
       s.name        AS service_name,
       COALESCE(s.walkin_price,
         (SELECT walkin_price FROM services
          WHERE gym_id = u.gym_id AND is_default = 1 LIMIT 1),
         0)          AS service_price,
       COUNT(c.id)   AS visit_count,
       COUNT(c.id) * COALESCE(s.walkin_price,
         (SELECT walkin_price FROM services
          WHERE gym_id = u.gym_id AND is_default = 1 LIMIT 1),
         0)          AS subtotal
     FROM users u
     LEFT JOIN users parent ON u.parent_id = parent.id AND parent.gym_id = u.gym_id
     LEFT JOIN checkins c
       ON c.user_id = u.id AND c.gym_id = u.gym_id
       AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
     LEFT JOIN services s ON c.service_id = s.id
     WHERE u.gym_id = ? AND u.institution_id = ? AND u.role = 'member'
     GROUP BY u.id, u.name, u.parent_id, parent.name, s.id, s.name, s.walkin_price
     ORDER BY u.name ASC, s.name ASC`,
    [month, gymId, institutionId],
  );

  res.json({
    month,
    institution: {
      id:               instRows[0].id,
      name:             instRows[0].name,
      rate_per_session: Number(instRows[0].rate_per_session),
    },
    breakdown: rows.map((r: any) => ({
      user_id:       r.user_id,
      name:          r.name,
      parent_id:     r.parent_id     ?? null,
      parent_name:   r.parent_name   ?? null,
      service_id:    r.service_id    ?? null,
      service_name:  r.service_name  ?? null,
      service_price: r.service_price != null ? Number(r.service_price) : null,
      visit_count:   Number(r.visit_count),
      subtotal:      Number(r.subtotal),
    })),
  });
});

// ---------------------------------------------------------------
// POST /api/billing/institutions/:id/mark-paid
// Record a payment for an institution's monthly bill.
// ---------------------------------------------------------------
const markPaidSchema = z.object({
  month:            z.string().regex(/^\d{4}-\d{2}$/),
  totalAmount:      z.number().positive(),
  paymentReference: z.string().optional(),
  notes:            z.string().optional(),
});

router.post('/institutions/:id/mark-paid', async (req: Request, res: Response) => {
  const gymId        = req.gym.id;
  const institutionId = parseInt(req.params.id);

  const parsed = markPaidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { month, totalAmount, paymentReference, notes } = parsed.data;

  const [instRows] = await pool.query<any[]>(
    'SELECT id FROM institutions WHERE id = ? AND gym_id = ?',
    [institutionId, gymId],
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  // Count actual visits for this month
  const [[visitRow]] = await pool.query<any[]>(
    `SELECT COUNT(c.id) AS total_visits
     FROM checkins c
     JOIN users u ON c.user_id = u.id AND u.gym_id = c.gym_id
     WHERE c.gym_id = ? AND u.institution_id = ?
       AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?`,
    [gymId, institutionId, month],
  );
  const totalVisits = Number(visitRow.total_visits);

  await pool.query(
    `INSERT INTO institutional_payments
       (gym_id, institution_id, month, total_visits, total_amount, currency, status, paid_at, payment_reference, notes)
     VALUES (?, ?, ?, ?, ?, 'RWF', 'paid', NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       status            = 'paid',
       total_visits      = VALUES(total_visits),
       total_amount      = VALUES(total_amount),
       paid_at           = NOW(),
       payment_reference = VALUES(payment_reference),
       notes             = VALUES(notes)`,
    [gymId, institutionId, month, totalVisits, totalAmount, paymentReference ?? null, notes ?? null],
  );

  const [[payment]] = await pool.query<any[]>(
    'SELECT * FROM institutional_payments WHERE institution_id = ? AND gym_id = ? AND month = ?',
    [institutionId, gymId, month],
  );

  res.json({ message: 'Payment recorded', payment });
});

// ---------------------------------------------------------------
// PATCH /api/billing/institutions/:id/status
// Update the payment status (pending / paid / overdue).
// ---------------------------------------------------------------
const statusSchema = z.object({
  month:  z.string().regex(/^\d{4}-\d{2}$/),
  status: z.enum(['pending', 'paid', 'overdue']),
});

router.patch('/institutions/:id/status', async (req: Request, res: Response) => {
  const gymId        = req.gym.id;
  const institutionId = parseInt(req.params.id);

  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { month, status } = parsed.data;

  const [instRows] = await pool.query<any[]>(
    'SELECT id FROM institutions WHERE id = ? AND gym_id = ?',
    [institutionId, gymId],
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  await pool.query(
    `INSERT INTO institutional_payments
       (gym_id, institution_id, month, total_visits, total_amount, status)
     VALUES (?, ?, ?, 0, 0, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status)`,
    [gymId, institutionId, month, status],
  );

  res.json({ message: 'Status updated' });
});

export default router;
