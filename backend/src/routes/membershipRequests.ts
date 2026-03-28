import { sendApprovalSMS } from '../services/sms.service';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { resolveGym } from '../middleware/gym.middleware';
import { requireRole } from '../middleware/role.middleware';
import { normalizePhone, validatePhone } from '../utils/phone';

const router = Router();

// resolveGym required on all routes — gym_id must never come from the body
router.use(resolveGym);

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT 1: POST /api/membership-requests
// Public — check-in tablet, no JWT required.
// ─────────────────────────────────────────────────────────────────────────────
const submitSchema = z.object({
  planId:         z.number().int().positive(),
  userId:         z.number().int().positive().optional(),
  newMemberName:  z.string().min(1).max(255).optional(),
  newMemberPhone: z.string().min(9).max(20).optional(),
}).refine(data => {
  // Must supply either an existing userId OR name + phone for a new member
  if (!data.userId && (!data.newMemberName || !data.newMemberPhone)) return false;
  return true;
}, { message: 'Provide either userId (existing member) or both newMemberName and newMemberPhone (new member)' });

router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const gymId = req.gym.id;
    const { planId, userId, newMemberName, newMemberPhone } = parsed.data;

    // 1. Verify plan exists and belongs to this gym
    const [planRows] = await pool.query<any[]>(
      'SELECT id FROM membership_plans WHERE id = ? AND gym_id = ? AND is_active = true',
      [planId, gymId]
    );
    if (!planRows[0]) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    if (userId) {
      // 2a. Verify existing user belongs to this gym
      const [userRows] = await pool.query<any[]>(
        'SELECT id FROM users WHERE id = ? AND gym_id = ?',
        [userId, gymId]
      );
      if (!userRows[0]) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }

      // Check for already-active membership
      const [activeMem] = await pool.query<any[]>(
        `SELECT id FROM user_memberships
         WHERE user_id = ? AND gym_id = ? AND status = 'active'
         LIMIT 1`,
        [userId, gymId]
      );
      if (activeMem[0]) {
        res.status(400).json({ error: 'Already has active membership' });
        return;
      }

      // Check for already-pending request
      const [pendingReq] = await pool.query<any[]>(
        `SELECT id FROM membership_requests
         WHERE user_id = ? AND gym_id = ? AND status = 'pending'
         LIMIT 1`,
        [userId, gymId]
      );
      if (pendingReq[0]) {
        res.status(400).json({ error: 'You already have a pending membership request. Please wait for manager approval.' });
        return;
      }
    } else {
      // 2b. Brand-new member — check phone not already registered at this gym
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizePhone(newMemberPhone!);
        if (!validatePhone(normalizedPhone)) throw new Error('Invalid phone number format');
      } catch (e: any) {
        res.status(400).json({ error: e.message });
        return;
      }
      const [existing] = await pool.query<any[]>(
        'SELECT id FROM users WHERE phone = ? AND gym_id = ?',
        [normalizedPhone, gymId]
      );
      if (existing[0]) {
        res.status(400).json({ error: 'Phone already registered. Please use check-in.' });
        return;
      }

      // Check for already-pending request for this phone
      const [pendingByPhone] = await pool.query<any[]>(
        `SELECT id FROM membership_requests
         WHERE new_member_phone = ? AND gym_id = ? AND status = 'pending'
         LIMIT 1`,
        [normalizedPhone, gymId]
      );
      if (pendingByPhone[0]) {
        res.status(400).json({ error: 'A pending membership request already exists for this phone number. Please wait for manager approval.' });
        return;
      }
    }

    // 4. Resolve the user id — create one for brand-new members so they are
    //    recognised on the next check-in attempt (phone lookup will find them).
    let resolvedUserId: number;

    if (userId) {
      resolvedUserId = userId;
      // Ensure status is active so validateCheckin step 3.5 can reach them
      await pool.query(
        `UPDATE users SET status = 'active' WHERE id = ? AND gym_id = ?`,
        [userId, gymId]
      );
    } else {
      // Create the member record now; approval will activate their membership
      const [insertUser] = await pool.query<any>(
        `INSERT INTO users (gym_id, name, phone, role, status)
         VALUES (?, ?, ?, 'member', 'active')`,
        [gymId, newMemberName, normalizePhone(newMemberPhone!)]
      );
      resolvedUserId = insertUser.insertId;
    }

    // 5. Insert the request
    const [result] = await pool.query<any>(
      `INSERT INTO membership_requests
         (gym_id, user_id, new_member_name, new_member_phone, plan_id, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [
        gymId,
        resolvedUserId,
        newMemberName  ?? null,
        newMemberPhone ? normalizePhone(newMemberPhone) : null,
        planId,
      ]
    );

    res.status(201).json({
      message:   'Request submitted. Awaiting manager approval.',
      requestId: result.insertId,
    });
  } catch (err) {
    console.error('POST /membership-requests', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT 2: GET /api/membership-requests
// Auth + gym_manager or gym_owner.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', authenticate, requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  try {
    const gymId  = req.gym.id;
    const status = (req.query.status as string) || 'pending';

    const validStatuses = ['pending', 'approved', 'rejected', 'all'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    const whereStatus  = status !== 'all' ? 'AND mr.status = ?' : '';
    const queryParams: unknown[] = status !== 'all' ? [gymId, status] : [gymId];

    const [requests] = await pool.query<any[]>(
      `SELECT
         mr.id,
         mr.status,
         mr.requested_at,
         mr.processed_at,
         mr.notes,
         COALESCE(u.name,  mr.new_member_name)  AS member_name,
         COALESCE(u.phone, mr.new_member_phone) AS member_phone,
         mr.user_id,
         mr.new_member_name,
         mr.new_member_phone,
         mp.name          AS plan_name,
         mp.price,
         mp.currency,
         mp.type          AS plan_type,
         mp.duration_days,
         mp.sessions,
         pb.name          AS processed_by_name
       FROM membership_requests mr
       LEFT JOIN users u  ON mr.user_id       = u.id
       JOIN  membership_plans mp ON mr.plan_id = mp.id AND mp.gym_id = mr.gym_id
       LEFT JOIN users pb  ON mr.processed_by  = pb.id
       WHERE mr.gym_id = ?
         ${whereStatus}
       ORDER BY mr.requested_at DESC`,
      queryParams
    );

    res.json({ requests, total: requests.length });
  } catch (err) {
    console.error('GET /membership-requests', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT 3: PATCH /api/membership-requests/:id/approve
// Auth + gym_manager or gym_owner.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/approve', authenticate, requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  try {
    const gymId     = req.gym.id;
    const requestId = parseInt(req.params.id);

    // 1. Load the pending request — scoped to this gym
    const [reqRows] = await pool.query<any[]>(
      `SELECT * FROM membership_requests
       WHERE id = ? AND gym_id = ? AND status = 'pending'`,
      [requestId, gymId]
    );
    if (!reqRows[0]) {
      res.status(404).json({ error: 'Request not found or already reviewed' });
      return;
    }
    const membershipReq = reqRows[0];

    // 2. Load the plan — must belong to this gym
    const [planRows] = await pool.query<any[]>(
      'SELECT * FROM membership_plans WHERE id = ? AND gym_id = ?',
      [membershipReq.plan_id, gymId]
    );
    if (!planRows[0]) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    const plan = planRows[0];

    let userId: number;
    let userName: string;
    let userPhone: string;

    if (membershipReq.user_id === null) {
      // 3. Brand-new member — create user now
      const [insertResult] = await pool.query<any>(
        `INSERT INTO users (gym_id, name, phone, role, status)
         VALUES (?, ?, ?, 'member', 'active')`,
        [gymId, membershipReq.new_member_name, membershipReq.new_member_phone]
      );
      userId    = insertResult.insertId;
      userName  = membershipReq.new_member_name;
      userPhone = membershipReq.new_member_phone;
    } else {
      // 4. Existing member — activate their account
      userId = membershipReq.user_id;
      await pool.query(
        `UPDATE users SET status = 'active' WHERE id = ? AND gym_id = ?`,
        [userId, gymId]
      );
      const [userRows] = await pool.query<any[]>(
        'SELECT name, phone FROM users WHERE id = ? AND gym_id = ?',
        [userId, gymId]
      );
      userName  = userRows[0]?.name  ?? '';
      userPhone = userRows[0]?.phone ?? '';
    }

    // 5. Cancel any existing active membership for this user at this gym
    await pool.query(
      `UPDATE user_memberships SET status = 'cancelled'
       WHERE user_id = ? AND gym_id = ? AND status = 'active'`,
      [userId, gymId]
    );

    // 6. Create the new membership
    const today      = new Date();
    const startDate  = toDateString(today);
    const endDate    = plan.type === 'time_based' && plan.duration_days
      ? toDateString(addDays(today, plan.duration_days))
      : null;
    const remSessions = plan.type === 'session_based' ? (plan.sessions ?? null) : null;

    const [memResult] = await pool.query<any>(
      `INSERT INTO user_memberships
         (gym_id, user_id, plan_id, start_date, end_date, remaining_sessions, status, assigned_by)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      [gymId, userId, plan.id, startDate, endDate, remSessions, req.user.id]
    );

    // 7. Mark the request as approved
    await pool.query(
      `UPDATE membership_requests
       SET status = 'approved', processed_at = NOW(), processed_by = ?
       WHERE id = ? AND gym_id = ?`,
      [req.user.id, requestId, gymId]
    );

    // Send approval SMS to member — never block approval if SMS fails
    try {
      await sendApprovalSMS(
        userPhone,
        userName,
        req.gym.name,
        plan.name,
        new Date().toISOString().split('T')[0],
        endDate ?? null,
        plan.sessions ?? null,
      );
    } catch (e) {
      console.error('[SMS] Approval SMS failed:', e);
    }

    res.json({
      message: 'Membership approved',
      user: { id: userId, name: userName, phone: userPhone },
      membership: {
        id:                 memResult.insertId,
        plan_name:          plan.name,
        start_date:         startDate,
        end_date:           endDate,
        remaining_sessions: remSessions,
      },
    });
  } catch (err) {
    console.error('PATCH /membership-requests/:id/approve', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT 4: PATCH /api/membership-requests/:id/reject
// Auth + gym_manager or gym_owner.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/reject', authenticate, requireRole('gym_owner', 'gym_manager'), async (req: Request, res: Response) => {
  try {
    const gymId     = req.gym.id;
    const requestId = parseInt(req.params.id);

    // 1. Verify request exists and is still pending — scoped to this gym
    const [reqRows] = await pool.query<any[]>(
      `SELECT id FROM membership_requests
       WHERE id = ? AND gym_id = ? AND status = 'pending'`,
      [requestId, gymId]
    );
    if (!reqRows[0]) {
      res.status(404).json({ error: 'Request not found or already reviewed' });
      return;
    }

    // 2. Mark as rejected
    await pool.query(
      `UPDATE membership_requests
       SET status = 'rejected', processed_at = NOW(), processed_by = ?
       WHERE id = ? AND gym_id = ?`,
      [req.user.id, requestId, gymId]
    );

    res.json({ message: 'Request rejected' });
  } catch (err) {
    console.error('PATCH /membership-requests/:id/reject', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
