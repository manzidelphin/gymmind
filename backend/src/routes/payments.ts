import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { resolveGym } from '../middleware/gym.middleware';
import { requireRole } from '../middleware/role.middleware';
import { requestPayment, getPaymentStatus } from '../services/momo.service';
import { sendApprovalSMS, sendPaymentMemberSMS, sendPaymentManagerSMS, sendCheckinSMS, sendWalkInMemberSMS, sendWalkInManagerSMS } from '../services/sms.service';

const router = Router();

router.use(resolveGym);

// ── Helpers (mirror of membershipRequests.ts) ──────────────────
function toDateString(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, days: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + days); return r;
}

// ---------------------------------------------------------------
// POST /api/payments/initiate
// Public (check-in kiosk). Initiates an MTN MoMo payment for a
// pending membership request.
// ---------------------------------------------------------------
const initiateSchema = z.object({
  membershipRequestId: z.number().int().positive(),
  payerPhone:          z.string().min(9),
});

router.post('/initiate', async (req: Request, res: Response) => {
  const parsed = initiateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId = req.gym.id;
  const { membershipRequestId, payerPhone } = parsed.data;

  try {
    // 1. Verify request belongs to this gym and is still pending
    const [reqRows] = await pool.query<any[]>(
      `SELECT mr.*, mp.price, mp.currency, mp.name AS plan_name
       FROM membership_requests mr
       JOIN membership_plans mp ON mp.id = mr.plan_id AND mp.gym_id = mr.gym_id
       WHERE mr.id = ? AND mr.gym_id = ? AND mr.status = 'pending'`,
      [membershipRequestId, gymId],
    );
    if (!reqRows[0]) {
      res.status(404).json({ error: 'Membership request not found or already processed' });
      return;
    }
    const membershipReq = reqRows[0];

    // 2. Get gym MoMo keys
    const [gymRows] = await pool.query<any[]>(
      'SELECT momo_subscription_key, momo_api_user_id, momo_api_key, name FROM gyms WHERE id = ?',
      [gymId],
    );
    const gym = gymRows[0];

    // 3. Generate reference ID and call MTN API
    const referenceId = uuidv4();

    try {
      await requestPayment({
        amount:              Number(membershipReq.price),
        currency:            membershipReq.currency || 'RWF',
        payerPhone,
        referenceId,
        description:         `${membershipReq.plan_name} membership at ${gym?.name ?? 'GymMind'}`,
        gymSubscriptionKey:  gym?.momo_subscription_key ?? undefined,
        gymApiUserId:        gym?.momo_api_user_id ?? undefined,
        gymApiKey:           gym?.momo_api_key ?? undefined,
      });
    } catch (momoErr: any) {
      console.error('[MoMo] requestPayment failed:', momoErr?.response?.data ?? momoErr.message);
      res.status(502).json({ error: 'Failed to send payment request to MTN. Please try again.' });
      return;
    }

    // 4. Record payment in DB
    const [insertResult] = await pool.query<any>(
      `INSERT INTO payments
         (gym_id, user_id, membership_request_id, amount, currency, payer_phone, mtn_transaction_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        gymId,
        membershipReq.user_id ?? null,
        membershipRequestId,
        Number(membershipReq.price),
        membershipReq.currency || 'RWF',
        payerPhone,
        referenceId,
      ],
    );

    res.json({
      paymentId:   insertResult.insertId,
      referenceId,
      amount:      Number(membershipReq.price),
      message:     'Check your phone for the MTN MoMo payment prompt',
    });
  } catch (err) {
    console.error('POST /payments/initiate', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------
// GET /api/payments/:referenceId/status
// Public (check-in kiosk polling). Checks MTN and, on success,
// runs the full membership approval flow automatically.
// ---------------------------------------------------------------
router.get('/:referenceId/status', async (req: Request, res: Response) => {
  const gymId       = req.gym.id;
  const referenceId = req.params.referenceId;

  try {
    // 1. Look up payment record
    const [payRows] = await pool.query<any[]>(
      'SELECT * FROM payments WHERE mtn_transaction_id = ? AND gym_id = ?',
      [referenceId, gymId],
    );
    if (!payRows[0]) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }
    const payment = payRows[0];

    // Already resolved — no need to call MTN again
    if (payment.status === 'successful') {
      res.json({ status: 'successful', message: 'Payment confirmed! Membership activated.' });
      return;
    }
    if (payment.status === 'failed') {
      res.json({ status: 'failed', message: payment.failure_reason ?? 'Payment failed.' });
      return;
    }

    // 2. Get gym keys for MTN call
    const [gymRows] = await pool.query<any[]>(
      'SELECT momo_subscription_key, momo_api_user_id, momo_api_key, name FROM gyms WHERE id = ?',
      [gymId],
    );
    const gym = gymRows[0];

    // 3. Query MTN API
    let momoStatus: 'SUCCESSFUL' | 'FAILED' | 'PENDING';
    try {
      momoStatus = await getPaymentStatus({
        referenceId,
        gymSubscriptionKey: gym?.momo_subscription_key ?? undefined,
        gymApiUserId:       gym?.momo_api_user_id ?? undefined,
        gymApiKey:          gym?.momo_api_key ?? undefined,
      });
    } catch (momoErr: any) {
      console.error('[MoMo] getPaymentStatus failed:', momoErr?.response?.data ?? momoErr.message);
      res.json({ status: 'pending', message: 'Waiting for payment confirmation...' });
      return;
    }

    // 4. Handle FAILED
    if (momoStatus === 'FAILED') {
      await pool.query(
        `UPDATE payments SET status = 'failed', failure_reason = 'Declined by MTN' WHERE id = ?`,
        [payment.id],
      );
      res.json({ status: 'failed', message: 'Payment was declined. Please try again.' });
      return;
    }

    // 5. Handle PENDING
    if (momoStatus === 'PENDING') {
      res.json({ status: 'pending', message: 'Waiting for payment confirmation...' });
      return;
    }

    // 6. Handle SUCCESSFUL — run full approval flow
    // Update payment record
    await pool.query(
      `UPDATE payments SET status = 'successful' WHERE id = ?`,
      [payment.id],
    );

    // Check if membership_request is still pending (avoid double-approvals)
    if (!payment.membership_request_id) {
      res.json({ status: 'successful', message: 'Payment confirmed! Membership activated.' });
      return;
    }

    const [reqRows] = await pool.query<any[]>(
      `SELECT * FROM membership_requests WHERE id = ? AND gym_id = ? AND status = 'pending'`,
      [payment.membership_request_id, gymId],
    );
    if (!reqRows[0]) {
      // Already approved (e.g., manager approved manually)
      res.json({ status: 'successful', message: 'Payment confirmed! Membership already activated.' });
      return;
    }
    const membershipReq = reqRows[0];

    const [planRows] = await pool.query<any[]>(
      'SELECT * FROM membership_plans WHERE id = ? AND gym_id = ?',
      [membershipReq.plan_id, gymId],
    );
    if (!planRows[0]) {
      res.json({ status: 'successful', message: 'Payment confirmed! Please see reception to activate membership.' });
      return;
    }
    const plan = planRows[0];

    let userId: number;
    let userName: string;
    let userPhone: string;

    if (membershipReq.user_id === null) {
      // Brand-new member — create user
      const [insertUser] = await pool.query<any>(
        `INSERT INTO users (gym_id, name, phone, role, status) VALUES (?, ?, ?, 'member', 'active')`,
        [gymId, membershipReq.new_member_name, membershipReq.new_member_phone],
      );
      userId    = insertUser.insertId;
      userName  = membershipReq.new_member_name;
      userPhone = membershipReq.new_member_phone;
    } else {
      userId = membershipReq.user_id;
      await pool.query(
        `UPDATE users SET status = 'active' WHERE id = ? AND gym_id = ?`,
        [userId, gymId],
      );
      const [userRows] = await pool.query<any[]>(
        'SELECT name, phone FROM users WHERE id = ? AND gym_id = ?',
        [userId, gymId],
      );
      userName  = userRows[0]?.name  ?? '';
      userPhone = userRows[0]?.phone ?? '';
    }

    // Cancel any existing active membership
    await pool.query(
      `UPDATE user_memberships SET status = 'cancelled' WHERE user_id = ? AND gym_id = ? AND status = 'active'`,
      [userId, gymId],
    );

    // Create the new membership
    const today      = new Date();
    const startDate  = toDateString(today);
    const endDate    = plan.type === 'time_based' && plan.duration_days
      ? toDateString(addDays(today, plan.duration_days))
      : null;
    let remSessions = plan.type === 'session_based' ? (plan.sessions ?? null) : null;

    const [membershipInsert] = await pool.query<any>(
      `INSERT INTO user_memberships
         (gym_id, user_id, plan_id, start_date, end_date, remaining_sessions, status, assigned_by)
       VALUES (?, ?, ?, ?, ?, ?, 'active', NULL)`,
      [gymId, userId, plan.id, startDate, endDate, remSessions],
    );
    const membershipId = membershipInsert.insertId;

    // Auto check-in immediately after payment — decrement session if applicable
    if (plan.type === 'session_based' && remSessions !== null && remSessions > 0) {
      await pool.query(
        `UPDATE user_memberships SET remaining_sessions = remaining_sessions - 1
         WHERE id = ? AND gym_id = ? AND remaining_sessions > 0`,
        [membershipId, gymId],
      );
      remSessions = remSessions - 1;
    }
    await pool.query(
      `INSERT INTO checkins (gym_id, user_id, membership_id, checkin_type) VALUES (?, ?, ?, 'individual')`,
      [gymId, userId, membershipId],
    );

    // Mark request as approved (payment is the approval trigger)
    await pool.query(
      `UPDATE membership_requests SET status = 'approved', processed_at = NOW() WHERE id = ? AND gym_id = ?`,
      [payment.membership_request_id, gymId],
    );

    // Update payment with resolved user_id (for new members)
    await pool.query(
      'UPDATE payments SET user_id = ? WHERE id = ?',
      [userId, payment.id],
    );

    // Send SMS notifications — never block response if SMS fails
    try {
      const [managerRows] = await pool.query<any[]>(
        `SELECT phone FROM users
         WHERE gym_id = ? AND role IN ('gym_owner', 'gym_manager') AND status = 'active' AND phone IS NOT NULL
         LIMIT 1`,
        [gymId],
      );
      const managerPhone: string | undefined = managerRows[0]?.phone;

      await Promise.allSettled([
        sendPaymentMemberSMS({
          memberPhone: userPhone,
          memberName:  userName,
          gymName:     gym?.name ?? 'GymMind',
          planName:    plan.name,
          amount:      payment.amount,
          startDate,
          endDate:     endDate ?? null,
          remainingSessions: remSessions ?? null,
        }),
        ...(managerPhone ? [sendPaymentManagerSMS({
          managerPhone,
          memberName:    userName,
          memberPhone:   userPhone,
          gymName:       gym?.name ?? 'GymMind',
          planName:      plan.name,
          amount:        payment.amount,
          transactionId: referenceId,
        })] : []),
        sendCheckinSMS(
          userPhone,
          userName,
          gym?.name ?? 'GymMind',
          plan.name,
          'individual',
          remSessions ?? null,
          endDate ?? null,
          managerPhone ?? null,
        ),
      ]);
    } catch (e) {
      console.error('[SMS] Payment/check-in SMS failed:', e);
    }

    res.json({
      status: 'successful',
      autoCheckedIn: true,
      message: 'Payment confirmed! You are now checked in.',
      user: { name: userName },
      membership: { plan_name: plan.name, end_date: endDate, remaining_sessions: remSessions },
    });
  } catch (err) {
    console.error('GET /payments/:referenceId/status', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------
// POST /api/payments/walkin/initiate
// Public (check-in kiosk). Walk-in day pass — no membership.
// Body: { payerPhone, serviceIds: number[], userPhone? }
// ---------------------------------------------------------------
const walkinInitiateSchema = z.object({
  payerPhone:  z.string().min(9),
  serviceIds:  z.array(z.number().int().positive()).min(1),
  userPhone:   z.string().min(9).optional(),
});

router.post('/walkin/initiate', async (req: Request, res: Response) => {
  const parsed = walkinInitiateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const gymId = req.gym.id;
  const { payerPhone, serviceIds, userPhone } = parsed.data;

  try {
    // 1. Load requested services + their walkin_price
    const placeholders = serviceIds.map(() => '?').join(', ');
    const [serviceRows] = await pool.query<any[]>(
      `SELECT id, name, walkin_price, currency FROM services
       WHERE id IN (${placeholders}) AND gym_id = ? AND is_active = true AND walkin_price > 0`,
      [...serviceIds, gymId],
    );
    if (serviceRows.length === 0) {
      res.status(400).json({ error: 'No valid walk-in services found' });
      return;
    }

    const totalAmount = serviceRows.reduce((sum: number, s: any) => sum + Number(s.walkin_price), 0);
    const currency    = serviceRows[0]?.currency ?? 'RWF';

    // 2. Optionally resolve user by phone
    let userId: number | null = null;
    if (userPhone) {
      const [userRows] = await pool.query<any[]>(
        'SELECT id FROM users WHERE gym_id = ? AND phone = ?',
        [gymId, userPhone],
      );
      userId = userRows[0]?.id ?? null;
    }

    // 3. Get gym MoMo keys
    const [gymRows] = await pool.query<any[]>(
      'SELECT momo_subscription_key, momo_api_user_id, momo_api_key, name FROM gyms WHERE id = ?',
      [gymId],
    );
    const gym = gymRows[0];

    // 4. Generate reference ID and call MTN
    const referenceId = uuidv4();
    const serviceNames = serviceRows.map((s: any) => s.name).join(', ');

    try {
      await requestPayment({
        amount:             totalAmount,
        currency,
        payerPhone,
        referenceId,
        description:        `Walk-in: ${serviceNames} at ${gym?.name ?? 'GymMind'}`,
        gymSubscriptionKey: gym?.momo_subscription_key ?? undefined,
        gymApiUserId:       gym?.momo_api_user_id ?? undefined,
        gymApiKey:          gym?.momo_api_key ?? undefined,
      });
    } catch (momoErr: any) {
      console.error('[MoMo] walkin requestPayment failed:', momoErr?.response?.data ?? momoErr.message);
      res.status(502).json({ error: 'Failed to send payment request to MTN. Please try again.' });
      return;
    }

    // 5. Record in walkin_payments
    const [insertResult] = await pool.query<any>(
      `INSERT INTO walkin_payments
         (gym_id, user_id, payer_phone, total_amount, currency, mtn_transaction_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [gymId, userId, payerPhone, totalAmount, currency, referenceId],
    );
    const walkinPaymentId = insertResult.insertId;

    // 6. Record services in walkin_payment_services
    for (const svc of serviceRows) {
      await pool.query(
        `INSERT INTO walkin_payment_services (walkin_payment_id, service_id, price, gym_id) VALUES (?, ?, ?, ?)`,
        [walkinPaymentId, svc.id, svc.walkin_price, gymId],
      );
    }

    res.json({
      referenceId,
      totalAmount,
      services: serviceRows.map((s: any) => ({ id: s.id, name: s.name, price: Number(s.walkin_price) })),
      message: 'Check your phone for the MTN MoMo payment prompt',
    });
  } catch (err: any) {
    console.error('[WalkIn] POST /walkin/initiate error:', err?.message ?? err);
    res.status(500).json({ error: 'Walk-in payment failed', details: err?.message });
  }
});

// ---------------------------------------------------------------
// GET /api/payments/walkin/:referenceId/status
// Public (check-in kiosk polling). On success, records check-ins.
// ---------------------------------------------------------------
router.get('/walkin/:referenceId/status', async (req: Request, res: Response) => {
  const gymId       = req.gym.id;
  const referenceId = req.params.referenceId;

  try {
    // Step 1 — load payment + gym credentials in one query
    const [payRows] = await pool.query<any[]>(
      `SELECT wp.*,
              g.name               AS gym_name,
              g.momo_api_user_id,
              g.momo_api_key,
              g.momo_subscription_key
       FROM walkin_payments wp
       JOIN gyms g ON g.id = wp.gym_id
       WHERE wp.mtn_transaction_id = ? AND wp.gym_id = ?`,
      [referenceId, gymId],
    );
    if (!payRows[0]) {
      res.status(404).json({ error: 'Walk-in payment not found' });
      return;
    }
    const payment = payRows[0];

    // Already finalised — return cached result
    if (payment.status === 'successful') {
      res.json({ status: 'successful', message: 'Payment confirmed! Enjoy your session.' });
      return;
    }
    if (payment.status === 'failed') {
      res.json({ status: 'failed', message: payment.failure_reason ?? 'Payment failed. Please try again.' });
      return;
    }

    // Step 2 — check with MTN using the gym's own credentials
    let momoStatus: 'SUCCESSFUL' | 'FAILED' | 'PENDING';
    if (process.env.NODE_ENV !== 'production') {
      momoStatus = 'SUCCESSFUL';
    } else {
      try {
        momoStatus = await getPaymentStatus({
          referenceId,
          gymSubscriptionKey: payment.momo_subscription_key ?? undefined,
          gymApiUserId:       payment.momo_api_user_id      ?? undefined,
          gymApiKey:          payment.momo_api_key           ?? undefined,
        });
      } catch (momoErr: any) {
        console.error('[MoMo] walkin getPaymentStatus failed:', momoErr?.response?.data ?? momoErr.message);
        res.json({ status: 'pending', message: 'Waiting for payment confirmation...' });
        return;
      }
    }

    // Step 4 — FAILED
    if (momoStatus === 'FAILED') {
      await pool.query(
        `UPDATE walkin_payments SET status = 'failed', failure_reason = 'Declined by MTN' WHERE id = ?`,
        [payment.id],
      );
      res.json({ status: 'failed', message: 'Payment failed. Please try again.' });
      return;
    }

    // Step 5 — PENDING
    if (momoStatus === 'PENDING') {
      res.json({ status: 'pending', message: 'Waiting for payment confirmation...' });
      return;
    }

    // Step 3 — SUCCESSFUL
    // a) Mark payment confirmed
    await pool.query(
      `UPDATE walkin_payments SET status = 'successful' WHERE id = ?`,
      [payment.id],
    );

    // b+c) Get services used in this payment
    const [svcRows] = await pool.query<any[]>(
      `SELECT wps.service_id, s.name, wps.price
       FROM walkin_payment_services wps
       JOIN services s ON s.id = wps.service_id
       WHERE wps.walkin_payment_id = ? AND wps.gym_id = ?`,
      [payment.id, gymId],
    );

    // b) Record check-ins
    const userId = payment.user_id ?? null;
    if (svcRows.length > 0) {
      for (const svc of svcRows) {
        await pool.query(
          `INSERT INTO checkins (gym_id, user_id, membership_id, checkin_type, service_id, payer_phone)
           VALUES (?, ?, NULL, 'walkin', ?, ?)`,
          [gymId, userId, svc.service_id, payment.payer_phone],
        );
      }
    } else {
      await pool.query(
        `INSERT INTO checkins (gym_id, user_id, membership_id, checkin_type, payer_phone)
         VALUES (?, ?, NULL, 'walkin', ?)`,
        [gymId, userId, payment.payer_phone],
      );
    }

    // d+e+f+g) SMS — wrapped so failure never blocks the response
    try {
      const [managerRows] = await pool.query<any[]>(
        `SELECT phone FROM users
         WHERE gym_id = ? AND role IN ('gym_owner', 'gym_manager')
           AND status = 'active' AND phone IS NOT NULL
         LIMIT 1`,
        [gymId],
      );
      const managerPhone: string | undefined = managerRows[0]?.phone;
      const serviceNames = svcRows.map((s: any) => s.name);

      await Promise.allSettled([
        sendWalkInMemberSMS({
          memberPhone: payment.payer_phone,
          gymName:     payment.gym_name,
          serviceNames,
          totalAmount: Number(payment.total_amount),
        }),
        ...(managerPhone ? [sendWalkInManagerSMS({
          managerPhone,
          gymName:     payment.gym_name,
          serviceNames,
          totalAmount: Number(payment.total_amount),
          payerPhone:  payment.payer_phone,
          referenceId,
        })] : []),
      ]);
    } catch (e) {
      console.error('[SMS] Walk-in SMS failed:', e);
    }

    // h) Response
    res.json({
      status:   'successful',
      services: svcRows.map((s: any) => ({ name: s.name })),
      total:    Number(payment.total_amount),
      message:  'Payment confirmed! Enjoy your session.',
    });
  } catch (err: any) {
    console.error('[WalkIn] GET /walkin/:referenceId/status error:', err?.message ?? err);
    res.status(500).json({ error: 'Walk-in status check failed', details: err?.message });
  }
});

// ---------------------------------------------------------------
// GET /api/payments
// Manager only — all payments for this gym.
// ---------------------------------------------------------------
router.get('/', authenticate, requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  const gymId = req.gym.id;
  try {
    const [rows] = await pool.query<any[]>(
      `SELECT
         p.id,
         p.amount,
         p.currency,
         p.payer_phone,
         p.status,
         p.failure_reason,
         p.created_at,
         COALESCE(u.name, mr.new_member_name) AS member_name,
         mp.name                               AS plan_name,
         COALESCE(
           (SELECT GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ')
            FROM plan_services ps
            JOIN services s ON s.id = ps.service_id
            WHERE ps.plan_id = mr.plan_id AND ps.gym_id = p.gym_id
           ),
           'Gym Floor'
         )                                     AS service_name,
         'membership'                          AS payment_type
       FROM payments p
       LEFT JOIN users               u  ON p.user_id               = u.id
       LEFT JOIN membership_requests mr ON p.membership_request_id = mr.id
       LEFT JOIN membership_plans    mp ON mr.plan_id              = mp.id
       WHERE p.gym_id = ?

       UNION ALL

       SELECT
         wp.id,
         wp.total_amount                       AS amount,
         wp.currency,
         wp.payer_phone,
         wp.status,
         NULL                                  AS failure_reason,
         wp.created_at,
         COALESCE(u2.name, 'Walk-in')          AS member_name,
         NULL                                  AS plan_name,
         (SELECT GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ')
          FROM walkin_payment_services wps
          JOIN services s ON s.id = wps.service_id
          WHERE wps.walkin_payment_id = wp.id AND wps.gym_id = wp.gym_id
         )                                     AS service_name,
         'walkin'                              AS payment_type
       FROM walkin_payments wp
       LEFT JOIN users u2 ON wp.user_id = u2.id AND u2.gym_id = wp.gym_id
       WHERE wp.gym_id = ? AND wp.status = 'successful'

       ORDER BY created_at DESC`,
      [gymId, gymId],
    );
    res.json({ payments: rows, total: rows.length });
  } catch (err: any) {
    console.error('[Payments] GET / error:', err?.message ?? err);
    if (err?.sql) console.error('[Payments] SQL:', err.sql);
    res.status(500).json({ error: 'Internal server error', details: err?.message });
  }
});

export default router;
