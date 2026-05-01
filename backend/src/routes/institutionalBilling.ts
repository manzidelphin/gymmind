import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { resolveGym } from '../middleware/gym.middleware';
import { requireRole } from '../middleware/role.middleware';
import { sendSms } from '../services/otp.service';
import { env } from '../config/env';
import { verifyToken } from '../services/jwt.service';
import { requestPayment, getPaymentStatus } from '../services/momo.service';

const router = Router();

// ---------------------------------------------------------------
// POST /api/billing/momo-webhook
// Public — MTN MoMo calls this after payment resolves.
// Required DB migrations (run once):
//   ALTER TABLE institutional_payments ADD COLUMN momo_reference_id VARCHAR(100) NULL;
//   ALTER TABLE gyms ADD COLUMN momo_number VARCHAR(20) NULL;
// ---------------------------------------------------------------
router.post('/momo-webhook', async (req: Request, res: Response) => {
  try {
    const { referenceId, status, financialTransactionId } = req.body ?? {};
    if (!referenceId) { res.status(400).json({ error: 'Missing referenceId' }); return; }

    if (status === 'SUCCESSFUL') {
      await pool.query(
        `UPDATE institutional_payments
         SET status = 'paid',
             paid_at = NOW(),
             payment_reference = ?
         WHERE momo_reference_id = ?`,
        [financialTransactionId ?? referenceId, referenceId],
      );
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[MoMo webhook] error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ---------------------------------------------------------------
// POST /api/billing/institutions/:id/request-payment
// HR admin authenticated — initiates MTN MoMo push to their phone.
// Body: { momoPhone, month? }
// ---------------------------------------------------------------
const requestPaymentSchema = z.object({
  momoPhone: z.string().min(9).max(20),
  month:     z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

router.post('/institutions/:id/request-payment', async (req: Request, res: Response) => {
  // ── Verify HR admin token ──
  const authHeader = req.headers.authorization;
  const hrToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!hrToken) { res.status(401).json({ error: 'Unauthorized' }); return; }

  let hrPayload: any;
  try {
    hrPayload = verifyToken(hrToken);
    if (hrPayload.role !== 'institution_admin') throw new Error('Forbidden');
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' }); return;
  }

  const institutionId = parseInt(req.params.id, 10);
  if (!(hrPayload.institutionIds as number[] | undefined)?.includes(institutionId)) {
    res.status(403).json({ error: 'Access denied to this institution' }); return;
  }

  const parsed = requestPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return;
  }

  const momoPhone = parsed.data.momoPhone;
  const month     = parsed.data.month ?? currentMonth();

  try {
    // Get institution
    const [[inst]] = await pool.query<any[]>(
      'SELECT id, name, gym_id, rate_per_session FROM institutions WHERE id = ? LIMIT 1',
      [institutionId],
    );
    if (!inst) { res.status(404).json({ error: 'Institution not found' }); return; }

    // Resolve invoice amount: prefer existing record, else calculate from visits
    const [[existing]] = await pool.query<any[]>(
      `SELECT id, total_amount, status FROM institutional_payments
       WHERE institution_id = ? AND gym_id = ? AND month = ? LIMIT 1`,
      [institutionId, inst.gym_id, month],
    );

    let amount: number;
    if (existing && Number(existing.total_amount) > 0) {
      amount = Number(existing.total_amount);
    } else {
      const [[visitRow]] = await pool.query<any[]>(
        `SELECT COUNT(DISTINCT c.id) AS visits
         FROM checkins c JOIN users u ON u.id = c.user_id
         WHERE c.gym_id = ? AND u.institution_id = ?
           AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?`,
        [inst.gym_id, institutionId, month],
      );
      amount = Number(visitRow?.visits ?? 0) * Number(inst.rate_per_session);
    }

    if (amount <= 0) {
      res.status(400).json({ error: 'No billable amount for this period' }); return;
    }

    // Initiate MoMo request-to-pay
    const externalId  = `GYM-${institutionId}-${month}-${Date.now()}`;
    const referenceId = await requestPayment({
      amount,
      currency:    env.MTN_MOMO_CURRENCY,
      payerPhone:  momoPhone,
      referenceId: externalId,
      description: `GymMind invoice — ${inst.name} ${month}`,
    });

    // Persist referenceId + update status to 'sent'
    if (existing) {
      await pool.query(
        `UPDATE institutional_payments
         SET momo_reference_id = ?, status = IF(status = 'paid', 'paid', 'sent'), sent_at = NOW()
         WHERE id = ?`,
        [referenceId, existing.id],
      );
    } else {
      await pool.query(
        `INSERT INTO institutional_payments
           (gym_id, institution_id, month, total_amount, currency, status, momo_reference_id, sent_at)
         VALUES (?, ?, ?, ?, 'RWF', 'sent', ?, NOW())`,
        [inst.gym_id, institutionId, month, amount, referenceId],
      );
    }

    res.json({ success: true, message: 'Payment request sent to HR phone', referenceId });
  } catch (err: any) {
    console.error('[MoMo] request-payment error:', err);
    res.status(500).json({ error: err.message ?? 'Payment request failed. Check MoMo configuration.' });
  }
});

router.use(resolveGym, authenticate, requireRole('gym_owner', 'gym_manager'));

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM');

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------
// GET /api/billing/summary?month=YYYY-MM
// Aggregate totals + invoice list for all institutions.
// Returns zeros/empty gracefully when no billing data exists.
// ---------------------------------------------------------------
router.get('/summary', async (req: Request, res: Response) => {
  const gymId      = req.gym.id;
  const monthParam = (req.query.month as string) || currentMonth();

  const parsed = monthSchema.safeParse(monthParam);
  if (!parsed.success) {
    res.status(400).json({ error: 'month must be YYYY-MM format (e.g. 2026-03)' });
    return;
  }
  const month = parsed.data;

  try {
    const [rows] = await pool.query<any[]>(
      `SELECT
         i.id,
         i.name,
         i.rate_per_session,
         COUNT(DISTINCT CASE WHEN c.id IS NOT NULL THEN c.user_id END) AS active_members,
         COUNT(c.id)                                                    AS total_visits,
         COUNT(c.id) * i.rate_per_session                               AS calculated_amount,
         ip.id               AS payment_id,
         ip.status           AS payment_status,
         ip.paid_at,
         ip.total_amount     AS paid_amount,
         ip.payment_reference
       FROM institutions i
       LEFT JOIN users u
         ON u.institution_id = i.id AND u.gym_id = i.gym_id AND u.parent_id IS NULL
       LEFT JOIN checkins c
         ON c.user_id = u.id AND c.gym_id = i.gym_id
         AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
       LEFT JOIN institutional_payments ip
         ON ip.institution_id = i.id AND ip.gym_id = i.gym_id AND ip.month = ?
       WHERE i.gym_id = ?
       GROUP BY i.id, i.name, i.rate_per_session,
                ip.id, ip.status, ip.paid_at, ip.total_amount, ip.payment_reference
       ORDER BY i.name ASC`,
      [month, month, gymId],
    );

    const invoices = rows.map((r: any) => ({
      id:                r.id,
      name:              r.name,
      rate_per_session:  Number(r.rate_per_session),
      active_members:    Number(r.active_members),
      total_visits:      Number(r.total_visits),
      calculated_amount: Number(r.calculated_amount) || 0,
      payment_id:        r.payment_id     ?? null,
      payment_status:    r.payment_status ?? null,
      paid_at:           r.paid_at        ?? null,
      paid_amount:       r.paid_amount != null ? Number(r.paid_amount) : null,
      payment_reference: r.payment_reference ?? null,
    }));

    const total_due       = invoices.reduce((s, i) => s + i.calculated_amount, 0);
    const total_collected = invoices
      .filter(i => i.payment_status === 'paid')
      .reduce((s, i) => s + (i.paid_amount ?? i.calculated_amount), 0);
    const outstanding     = Math.max(0, total_due - total_collected);

    res.json({ month, total_due, total_collected, outstanding, invoices });
  } catch {
    res.json({ month, total_due: 0, total_collected: 0, outstanding: 0, invoices: [] });
  }
});

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
       COUNT(c.id) * i.rate_per_session                               AS calculated_amount,
       ip.id               AS payment_id,
       ip.status           AS payment_status,
       ip.paid_at,
       ip.sent_at,
       ip.total_amount     AS paid_amount,
       ip.payment_reference
     FROM institutions i
     LEFT JOIN users u
       ON u.institution_id = i.id AND u.gym_id = i.gym_id AND u.parent_id IS NULL
     LEFT JOIN checkins c
       ON c.user_id = u.id AND c.gym_id = i.gym_id
       AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
     LEFT JOIN institutional_payments ip
       ON ip.institution_id = i.id AND ip.gym_id = i.gym_id AND ip.month = ?
     WHERE i.gym_id = ?
     GROUP BY i.id, i.name, i.rate_per_session,
              ip.id, ip.status, ip.paid_at, ip.sent_at, ip.total_amount, ip.payment_reference
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
      sent_at:           r.sent_at           ?? null,
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
       i.rate_per_session AS service_price,
       COUNT(c.id)   AS visit_count,
       COUNT(c.id) * i.rate_per_session AS subtotal
     FROM users u
     JOIN institutions i ON i.id = u.institution_id AND i.gym_id = u.gym_id
     LEFT JOIN users parent ON u.parent_id = parent.id AND parent.gym_id = u.gym_id
     LEFT JOIN checkins c
       ON c.user_id = u.id AND c.gym_id = u.gym_id
       AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
     LEFT JOIN services s ON c.service_id = s.id
     WHERE u.gym_id = ? AND u.institution_id = ? AND u.role = 'member'
     GROUP BY u.id, u.name, u.parent_id, parent.name, s.id, s.name, i.rate_per_session
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

  // Calculate real visits/amount so we never insert zeros
  const [visitRows] = await pool.query<any[]>(
    `SELECT COUNT(c.id) AS total_visits,
            COUNT(c.id) * i.rate_per_session AS total_amount
     FROM institutions i
     LEFT JOIN users u
       ON u.institution_id = i.id AND u.gym_id = i.gym_id AND u.parent_id IS NULL
     LEFT JOIN checkins c
       ON c.user_id = u.id AND c.gym_id = i.gym_id
       AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
     WHERE i.id = ? AND i.gym_id = ?`,
    [month, institutionId, gymId],
  );
  const totalVisits = Number((visitRows as any[])[0]?.total_visits ?? 0);
  const totalAmount = Number((visitRows as any[])[0]?.total_amount ?? 0);

  await pool.query(
    `INSERT INTO institutional_payments
       (gym_id, institution_id, month, total_visits, total_amount, status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status       = VALUES(status),
       total_visits = IF(total_visits = 0, VALUES(total_visits), total_visits),
       total_amount = IF(total_amount = 0, VALUES(total_amount), total_amount)`,
    [gymId, institutionId, month, totalVisits, totalAmount, status],
  );

  res.json({ message: 'Status updated' });
});

// ---------------------------------------------------------------
// POST /api/billing/generate
// Generate (or regenerate) an invoice for an institution-month.
// Body: { institutionId, month, year }
// Amount = SUM(days_attended × institution.rate_per_session) per employee.
// Returns: { id, access_token, month, total_amount, total_visits, breakdown }
// ---------------------------------------------------------------
const generateSchema = z.object({
  institutionId: z.number().int().positive(),
  month:         z.number().int().min(1).max(12),
  year:          z.number().int().min(2020).max(2100),
});

router.post('/generate', async (req: Request, res: Response) => {
  const gymId  = req.gym.id;
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { institutionId, month, year } = parsed.data;
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const [instRows] = await pool.query<any[]>(
    'SELECT id, name, rate_per_session FROM institutions WHERE id = ? AND gym_id = ?',
    [institutionId, gymId],
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }
  const ratePerSession = Number(instRows[0].rate_per_session);

  // Per-employee: count distinct days attended this month
  const [empRows] = await pool.query<any[]>(
    `SELECT u.id,
            COUNT(DISTINCT DATE(c.checked_in_at)) AS days_attended
     FROM users u
     LEFT JOIN checkins c
       ON c.user_id = u.id AND c.gym_id = u.gym_id
       AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
     WHERE u.gym_id = ? AND u.institution_id = ? AND u.role = 'member'
     GROUP BY u.id`,
    [monthStr, gymId, institutionId],
  );

  // Total = SUM(days_attended × rate_per_session) across all employees
  const totalVisits = empRows.reduce((s, r) => s + Number(r.days_attended), 0);
  const totalAmount = totalVisits * ratePerSession;
  const accessToken = randomBytes(32).toString('hex');

  await pool.query(
    `INSERT INTO institutional_payments
       (gym_id, institution_id, month, total_visits, total_amount, currency, status, access_token)
     VALUES (?, ?, ?, ?, ?, 'RWF', 'pending', ?)
     ON DUPLICATE KEY UPDATE
       total_visits  = VALUES(total_visits),
       total_amount  = VALUES(total_amount),
       access_token  = VALUES(access_token),
       status        = IF(status = 'paid', 'paid', 'pending')`,
    [gymId, institutionId, monthStr, totalVisits, totalAmount, accessToken],
  );

  const [[payment]] = await pool.query<any[]>(
    'SELECT id, access_token, month, total_visits, total_amount FROM institutional_payments WHERE institution_id = ? AND gym_id = ? AND month = ?',
    [institutionId, gymId, monthStr],
  );

  res.json({
    id:             payment.id,
    access_token:   payment.access_token,
    month:          payment.month,
    total_visits:   Number(payment.total_visits),
    total_amount:   Number(payment.total_amount),
    rate_per_session: ratePerSession,
  });
});

// ---------------------------------------------------------------
// POST /api/billing/send-to-hr
// Find or generate invoice for institution+month, then SMS all HR admins.
// Body: { institutionId, month }
// ---------------------------------------------------------------
const sendToHrSchema = z.object({
  institutionId: z.number().int().positive(),
  month:         z.string().regex(/^\d{4}-\d{2}$/),
});

router.post('/send-to-hr', async (req: Request, res: Response) => {
  const gymId  = req.gym.id;
  const parsed = sendToHrSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { institutionId, month } = parsed.data;

  // Verify institution belongs to this gym
  const [instRows] = await pool.query<any[]>(
    'SELECT id, name, rate_per_session FROM institutions WHERE id = ? AND gym_id = ?',
    [institutionId, gymId],
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }
  const inst         = instRows[0];
  const ratePerSession = Number(inst.rate_per_session);

  // Get HR admins for this institution
  const [hrAdmins] = await pool.query<any[]>(
    `SELECT id, name, phone FROM users
     WHERE gym_id = ? AND institution_id = ? AND role = 'institution_admin' AND phone IS NOT NULL`,
    [gymId, institutionId],
  );
  if (!hrAdmins.length) {
    res.status(404).json({ error: 'No HR admin registered for this institution. Add one in the Institutions page.' });
    return;
  }

  // Get gym name for SMS
  const [[gym]] = await pool.query<any[]>('SELECT name FROM gyms WHERE id = ?', [gymId]);

  // Find or generate invoice (count actual checkin days per employee)
  const [empRows] = await pool.query<any[]>(
    `SELECT u.id,
            COUNT(DISTINCT DATE(c.checked_in_at)) AS days_attended
     FROM users u
     LEFT JOIN checkins c
       ON c.user_id = u.id AND c.gym_id = u.gym_id
       AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
     WHERE u.gym_id = ? AND u.institution_id = ? AND u.role = 'member'
     GROUP BY u.id`,
    [month, gymId, institutionId],
  );
  const totalVisits = empRows.reduce((s: number, r: any) => s + Number(r.days_attended), 0);
  const totalAmount = totalVisits * ratePerSession;
  const accessToken = randomBytes(32).toString('hex');

  await pool.query(
    `INSERT INTO institutional_payments
       (gym_id, institution_id, month, total_visits, total_amount, currency, status, access_token, sent_at)
     VALUES (?, ?, ?, ?, ?, 'RWF', 'sent', ?, NOW())
     ON DUPLICATE KEY UPDATE
       total_visits  = VALUES(total_visits),
       total_amount  = VALUES(total_amount),
       access_token  = COALESCE(access_token, VALUES(access_token)),
       status        = IF(status = 'paid', 'paid', 'sent'),
       sent_at       = IF(status = 'paid', sent_at, NOW())`,
    [gymId, institutionId, month, totalVisits, totalAmount, accessToken],
  );

  const [[payment]] = await pool.query<any[]>(
    'SELECT * FROM institutional_payments WHERE institution_id = ? AND gym_id = ? AND month = ?',
    [institutionId, gymId, month],
  );

  // Format month label for SMS
  const [y, m] = month.split('-');
  const monthLabel = new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Send SMS to each HR admin
  const sentTo: string[] = [];
  for (const hr of hrAdmins) {
    const msg =
      `Hello ${hr.name}, your ${inst.name} employee wellness invoice ` +
      `from ${gym.name} for ${monthLabel} is ready. ` +
      `Total: ${totalAmount.toLocaleString()} RWF. ` +
      `Login to view and pay: ${env.FRONTEND_URL}/hr/login ` +
      `(your phone number is your login).`;
    try {
      await sendSms(hr.phone, msg);
      sentTo.push(hr.phone);
    } catch (err) {
      console.error(`[send-to-hr] SMS failed for ${hr.phone}:`, err);
    }
  }

  res.json({ success: true, sentTo, invoice: payment });
});

export default router;
