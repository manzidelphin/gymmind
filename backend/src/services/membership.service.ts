import { pool } from '../config/db';
import type { CheckinResult, User, UserMembership } from '../types';

type MembershipWithPlan = UserMembership & { plan_name: string; type: string };

/**
 * Fetches the active membership for a user at a specific gym.
 * gym_id is always passed explicitly — never inferred from the membership row alone.
 */
export async function getActiveMembership(
  userId: number,
  gymId: number
): Promise<MembershipWithPlan | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT um.*, mp.name AS plan_name, mp.type
     FROM user_memberships um
     JOIN membership_plans mp ON um.plan_id = mp.id AND mp.gym_id = ?
     WHERE um.user_id = ? AND um.gym_id = ? AND um.status = 'active'
     ORDER BY um.created_at DESC
     LIMIT 1`,
    [gymId, userId, gymId]
  );
  return rows[0] ?? null;
}

/**
 * Decrements remaining_sessions by 1 for a session-based membership.
 * gym_id is included in the WHERE clause as a security belt.
 */
export async function decrementSession(membershipId: number, gymId: number): Promise<void> {
  await pool.query(
    `UPDATE user_memberships
     SET remaining_sessions = remaining_sessions - 1
     WHERE id = ? AND gym_id = ? AND remaining_sessions > 0`,
    [membershipId, gymId]
  );
}

/**
 * Core check-in validation logic.
 *
 * Evaluation order:
 *   1. User exists and is active at this gym
 *   2. Institutional employee → check service coverage if serviceId given
 *   3. Dependent of an institutional employee → same service check
 *   4. Individual → must have an active membership
 *   5. Validate membership by type; if serviceId given, verify plan covers it
 */
export async function validateCheckin(
  userId: number,
  gymId: number,
  serviceId?: number
): Promise<CheckinResult> {
  // ── STEP 1: Fetch user, scoped to this gym ──────────────────────────────
  const [userRows] = await pool.query<any[]>(
    'SELECT * FROM users WHERE id = ? AND gym_id = ?',
    [userId, gymId]
  );

  const user: User | undefined = userRows[0];

  if (!user) {
    return { allowed: false, reason: 'user_not_found' };
  }

  if (user.status === 'pending') {
    const [[pendingReq]] = await pool.query<any[]>(
      `SELECT mr.id, mp.name AS plan_name
       FROM membership_requests mr
       JOIN membership_plans mp ON mr.plan_id = mp.id AND mp.gym_id = mr.gym_id
       WHERE mr.user_id = ? AND mr.gym_id = ? AND mr.status = 'pending'
       LIMIT 1`,
      [userId, gymId],
    );
    return { allowed: false, reason: 'pending_approval', pendingPlan: pendingReq?.plan_name, user };
  }

  if (user.institution_id !== null) {
    if (user.status === 'suspended') { return { allowed: false, reason: 'user_suspended', user }; }
    if (serviceId !== undefined) {
      const denied = await checkInstitutionServiceAccess(
        user.institution_id,
        serviceId,
        gymId,
        user.parent_id !== null // is dependent?
      );
      if (denied) return { ...denied, user };
    }

    // Fetch service name if provided
    const serviceName = serviceId ? await getServiceName(serviceId, gymId) : undefined;
    return { allowed: true, checkin_type: 'institutional', user, serviceName };
  }

  // ── STEP 3: Dependent of an institutional employee ──────────────────────
  if (user.parent_id !== null) {
    const [parentRows] = await pool.query<any[]>(
      'SELECT institution_id FROM users WHERE id = ? AND gym_id = ?',
      [user.parent_id, gymId]
    );
    const parent = parentRows[0];
    if (parent?.institution_id !== null && parent?.institution_id !== undefined) {
      if (serviceId !== undefined) {
        const denied = await checkInstitutionServiceAccess(
          parent.institution_id,
          serviceId,
          gymId,
          true // is dependent
        );
        if (denied) return { ...denied, user };
      }

      const serviceName = serviceId ? await getServiceName(serviceId, gymId) : undefined;
      return { allowed: true, checkin_type: 'dependent', user, serviceName };
    }
    // Parent has no institution — fall through to individual check
  }

  // Check status for non-institutional members
  if (user.status !== 'active') {
    return { allowed: false, reason: 'user_suspended', user };
  }
  // ── STEP 3.5: Check for a pending membership request ────────────────────
  const [[pendingReq]] = await pool.query<any[]>(
    `SELECT mr.id, mp.name AS plan_name
     FROM membership_requests mr
     JOIN membership_plans mp ON mr.plan_id = mp.id AND mp.gym_id = mr.gym_id
     WHERE mr.user_id = ? AND mr.gym_id = ? AND mr.status = 'pending'
     LIMIT 1`,
    [userId, gymId],
  );
  if (pendingReq) {
    return { allowed: false, reason: 'pending_approval', pendingPlan: pendingReq.plan_name, user };
  }

  // ── STEP 4: Find active individual membership ───────────────────────────
  const membership = await getActiveMembership(userId, gymId);

  if (!membership) {
    return { allowed: false, reason: 'no_membership', user };
  }

  // ── STEP 5: Validate by membership type ────────────────────────────────
  if (membership.type === 'time_based') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(membership.end_date!);
    endDate.setHours(0, 0, 0, 0);

    if (endDate < today) {
      await pool.query(
        `UPDATE user_memberships SET status = 'expired'
         WHERE id = ? AND gym_id = ?`,
        [membership.id, gymId]
      );
      return { allowed: false, reason: 'membership_expired', expiredOn: membership.end_date ?? undefined, planName: membership.plan_name, user };
    }

    // Check service is included in plan
    if (serviceId !== undefined) {
      const denied = await checkPlanServiceAccess(membership.plan_id, serviceId, gymId, membership.plan_name);
      if (denied) return { ...denied, user };
    }

    const serviceName = serviceId ? await getServiceName(serviceId, gymId) : undefined;
    return { allowed: true, checkin_type: 'individual', user, membership, serviceName };
  }

  if (membership.type === 'session_based') {
    if ((membership.remaining_sessions ?? 0) <= 0) {
      return { allowed: false, reason: 'no_sessions', user };
    }

    // Check service is included in plan before decrementing
    if (serviceId !== undefined) {
      const denied = await checkPlanServiceAccess(membership.plan_id, serviceId, gymId, membership.plan_name);
      if (denied) return { ...denied, user };
    }

    await decrementSession(membership.id, gymId);

    const serviceName = serviceId ? await getServiceName(serviceId, gymId) : undefined;
    return {
      allowed: true,
      checkin_type: 'individual',
      user,
      membership: { ...membership, remaining_sessions: membership.remaining_sessions! - 1 },
      serviceName,
    };
  }

  // institutional plan type
  if (serviceId !== undefined) {
    const denied = await checkPlanServiceAccess(membership.plan_id, serviceId, gymId, membership.plan_name);
    if (denied) return { ...denied, user };
  }

  const serviceName = serviceId ? await getServiceName(serviceId, gymId) : undefined;
  return { allowed: true, checkin_type: 'individual', user, membership, serviceName };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getServiceName(serviceId: number, gymId: number): Promise<string | undefined> {
  const [rows] = await pool.query<any[]>(
    'SELECT name FROM services WHERE id = ? AND gym_id = ?',
    [serviceId, gymId]
  );
  return rows[0]?.name;
}

/**
 * Check if an institution covers the given service.
 * Returns a denial result object if not allowed, or null if allowed.
 */
async function checkInstitutionServiceAccess(
  institutionId: number,
  serviceId: number,
  gymId: number,
  isDependent: boolean
): Promise<Pick<CheckinResult, 'allowed' | 'reason' | 'serviceName'> | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT allowed_for FROM institution_services
     WHERE institution_id = ? AND service_id = ? AND gym_id = ?`,
    [institutionId, serviceId, gymId]
  );

  if (!rows[0]) {
    const serviceName = await getServiceName(serviceId, gymId);
    return {
      allowed: false,
      reason: 'service_not_covered',
      serviceName,
    };
  }

  const allowedFor: string = rows[0].allowed_for;

  if (allowedFor === 'employees' && isDependent) {
    const serviceName = await getServiceName(serviceId, gymId);
    return { allowed: false, reason: 'service_not_covered', serviceName };
  }

  if (allowedFor === 'dependents' && !isDependent) {
    const serviceName = await getServiceName(serviceId, gymId);
    return { allowed: false, reason: 'service_not_covered', serviceName };
  }

  return null; // allowed
}

/**
 * Check if a membership plan includes the given service.
 * Returns a denial result object if not included, or null if included.
 */
async function checkPlanServiceAccess(
  planId: number,
  serviceId: number,
  gymId: number,
  planName: string
): Promise<Pick<CheckinResult, 'allowed' | 'reason' | 'serviceName' | 'planName'> | null> {
  const [rows] = await pool.query<any[]>(
    'SELECT id FROM plan_services WHERE plan_id = ? AND service_id = ? AND gym_id = ?',
    [planId, serviceId, gymId]
  );

  if (!rows[0]) {
    const serviceName = await getServiceName(serviceId, gymId);
    return {
      allowed: false,
      reason: 'service_not_in_plan',
      serviceName,
      planName,
    };
  }

  return null; // included
}
