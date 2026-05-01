/**
 * CHECK-IN ROUTE
 *
 * POST /api/checkin
 * Requires: X-Gym-Slug header + valid OTP for the member's phone.
 * No JWT required — the front-desk tablet uses OTP-based check-in.
 *
 * ---------------------------------------------------------------
 * CURL TEST COMMANDS
 * ---------------------------------------------------------------
 *
 * Step 1 — get an OTP for the member:
 *   curl -X POST http://localhost:3002/api/auth/send-otp \
 *     -H "Content-Type: application/json" \
 *     -H "X-Gym-Slug: kigali-fitness" \
 *     -d '{"phone": "0788100003"}'
 *
 * Step 2 — check in (use devCode from step 1):
 *   curl -X POST http://localhost:3002/api/checkin \
 *     -H "Content-Type: application/json" \
 *     -H "X-Gym-Slug: kigali-fitness" \
 *     -d '{"phone": "0788100003", "otp": "<devCode>"}'
 *
 * Test suspended user (manually set status='suspended' in DB first):
 *   curl -X POST http://localhost:3002/api/checkin \
 *     -H "Content-Type: application/json" \
 *     -H "X-Gym-Slug: kigali-fitness" \
 *     -d '{"phone": "0788100003", "otp": "<devCode>"}'
 *
 * Test institutional employee (Grace Ingabire, phone 0788100005):
 *   — same flow, should return checkin_type: 'institutional'
 *
 * Test dependent (Henry Ingabire, phone 0788100006):
 *   — should return checkin_type: 'dependent'
 * ---------------------------------------------------------------
 */

import { sendCheckinSMS } from '../services/sms.service';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { resolveGym } from '../middleware/gym.middleware';
import { verifyOTP, peekOTP } from '../services/otp.service';
import { validateCheckin } from '../services/membership.service';
import { normalizePhone } from '../utils/phone';
import { pool } from '../config/db';
import { env } from '../config/env';

const router = Router();

// All check-in requests must identify the gym
router.use(resolveGym);

// ── Public: list active membership plans for this gym ─────────────────────
// Used by the check-in tablet to show "Buy Membership" options.
// No JWT required — plans are public information (like a menu).
router.get('/plans', async (req: Request, res: Response) => {
  const gymId = req.gym.id;
  const [rows] = await pool.query<any[]>(
    `SELECT id, name, type, duration_days, sessions, price
     FROM membership_plans
     WHERE gym_id = ? AND is_active = true
     ORDER BY price ASC`,
    [gymId]
  );
  res.json(rows);
});

// ── POST /checkin/peek ─────────────────────────────────────────────────────
// Validates the OTP WITHOUT consuming it and returns whether the caller has
// an active membership.  The frontend uses this to decide whether to show
// the service-selection step before calling the real /checkin endpoint.
// The OTP remains valid so the subsequent /checkin call can consume it.
const peekSchema = z.object({
  phone: z.string().min(9),
  otp:   z.string().length(6),
});

router.post('/peek', async (req: Request, res: Response) => {
  const parsed = peekSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const phone = normalizePhone(parsed.data.phone);
  const gymId = req.gym.id;

  const otpValid = await peekOTP(gymId, phone, parsed.data.otp);
  if (!otpValid) {
    res.status(401).json({ hasMembership: false });
    return;
  }

  // Lightweight membership check — no side effects (no session decrement, no recording)
  const [userRows] = await pool.query<any[]>(
    'SELECT id, status, institution_id, parent_id FROM users WHERE gym_id = ? AND phone = ?',
    [gymId, phone]
  );

  const user = userRows[0];
  if (!user) {
    res.json({ hasMembership: false });
    return;
  }
  // Institutional employee → always has access (even if unclaimed)
  if (user.institution_id !== null && user.status !== 'suspended') {
    res.json({ hasMembership: true });
    return;
  }
  if (user.status !== 'active') {
    res.json({ hasMembership: false });
    return;
  }

  // Dependent of an institutional employee
  if (user.parent_id !== null) {
    const [parentRows] = await pool.query<any[]>(
      'SELECT institution_id FROM users WHERE id = ? AND gym_id = ?',
      [user.parent_id, gymId]
    );
    if (parentRows[0]?.institution_id != null) {
      res.json({ hasMembership: true });
      return;
    }
  }

  // Individual — check for an active membership
  const [memRows] = await pool.query<any[]>(
    `SELECT id FROM user_memberships
     WHERE user_id = ? AND gym_id = ? AND status = 'active'
     LIMIT 1`,
    [user.id, gymId]
  );

  res.json({ hasMembership: !!memRows[0] });
});

const checkinSchema = z.object({
  phone:     z.string().min(9),
  otp:       z.string().length(6),
  serviceId: z.number().int().positive().optional(),
});

router.post('/', async (req: Request, res: Response) => {
  const parsed = checkinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const phone = normalizePhone(parsed.data.phone);
  const gymId = req.gym.id;

  // Verify OTP — scoped to this gym + phone. Marks it used on success.
  const otpValid = await verifyOTP(gymId, phone, parsed.data.otp);
  if (!otpValid) {
    res.status(401).json({ allowed: false, message: 'Invalid or expired OTP' });
    return;
  }

  // Resolve the user at this gym
  const [userRows] = await pool.query<any[]>(
    'SELECT * FROM users WHERE gym_id = ? AND phone = ?',
    [gymId, phone]
  );

  if (!userRows[0]) {
    res.status(200).json({ allowed: false, reason: 'user_not_found', message: 'No account found for this phone at this gym' });
    return;
  }

  const userId: number = userRows[0].id;

  // Run the full membership validation logic
  const result = await validateCheckin(userId, gymId, parsed.data.serviceId);

  if (!result.allowed) {
    // Log denied check-ins for audit (optional but useful for support)
    const serviceLabel = result.serviceName ? `${result.serviceName} ` : '';
    const message = {
      user_not_found:        'User not found',
      user_suspended:        'Account suspended — please see reception',
      no_membership:         'No active membership',
      membership_expired:    'Membership has expired',
      no_sessions:           'No sessions remaining',
      service_not_covered:   `Your company does not cover ${serviceLabel}access`,
      service_not_in_plan:   result.planName
        ? `${serviceLabel}is not included in your ${result.planName} plan`
        : `This service is not included in your plan`,
      pending_approval:      result.pendingPlan
        ? `Your ${result.pendingPlan} membership request is pending approval`
        : 'Your membership request is pending approval',
    }[result.reason!] ?? 'Check-in denied';

    res.status(200).json({
      allowed: false,
      reason: result.reason,
      message,
      user: result.user ? { id: result.user.id, name: result.user.name } : undefined,
      ...(result.reason === 'membership_expired' ? { expiredOn: result.expiredOn, planName: result.planName } : {}),
      ...(result.reason === 'pending_approval'   ? { pendingPlan: result.pendingPlan } : {}),
      ...(result.serviceName ? { service_name: result.serviceName } : {}),
    });
    return;
  }

  // Record the successful check-in
  // Rate-limit: prevent duplicate check-ins for the same service within 10 hours
  const serviceId = parsed.data.serviceId ?? null;
  const [recentRows] = await pool.query<any[]>(
    `SELECT id FROM checkins
     WHERE gym_id = ? AND user_id = ?
       AND (service_id = ? OR (service_id IS NULL AND ? IS NULL))
       AND checked_in_at > DATE_SUB(NOW(), INTERVAL 10 HOUR)
     LIMIT 1`,
    [gymId, userId, serviceId, serviceId]
  );

  if (recentRows[0]) {
    res.json({
      allowed: false,
      reason: 'already_checked_in',
      message: 'Already checked in for this service today',
      user: { name: result.user!.name },
    });
    return;
  }

  await pool.query(
    `INSERT INTO checkins (gym_id, user_id, membership_id, checkin_type, service_id)
     VALUES (?, ?, ?, ?, ?)`,
    [gymId, userId, result.membership?.id ?? null, result.checkin_type, parsed.data.serviceId ?? null]
  );

  // Get manager phone for this gym
  const [managers] = await pool.query<any[]>(
    'SELECT phone FROM users WHERE gym_id = ? AND role IN (?,?) AND status = ? AND phone IS NOT NULL LIMIT 1',
    [req.gym.id, 'gym_owner', 'gym_manager', 'active']
  );
  const managerPhone = managers[0]?.phone ?? null;

  // Send SMS to member and manager — never block check-in if SMS fails
  try {
    await sendCheckinSMS(
      result.user!.phone,
      result.user!.name,
      req.gym.name,
      result.membership?.plan_name ?? 'Corporate',
      result.checkin_type!,
      result.membership?.remaining_sessions,
      result.membership?.end_date,
      managerPhone,
      result.serviceName ?? null,
    );
  } catch (e) {
    console.error('[SMS] Check-in SMS failed:', e);
  }

  // Build the response — enough info for the front-desk UI
  const membership = result.membership;
  let remaining: string | undefined;

  if (membership) {
    if (membership.type === 'time_based' && membership.end_date) {
      const msLeft = new Date(membership.end_date).getTime() - Date.now();
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
      remaining = `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`;
    } else if (membership.type === 'session_based') {
      const s = membership.remaining_sessions ?? 0;
      remaining = `${s} session${s !== 1 ? 's' : ''} remaining`;
    }
  }

  res.json({
    allowed: true,
    checkin_type: result.checkin_type,
    message: 'Welcome!',
    user: { name: result.user!.name },
    membership: membership
      ? { plan_name: membership.plan_name, remaining }
      : undefined,
    ...(result.serviceName ? { service_name: result.serviceName } : {}),
  });
});

export default router;
