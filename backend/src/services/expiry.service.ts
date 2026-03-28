import { pool } from '../config/db';
import { sendSMS } from './sms.service';
import { sendMonthlyReport } from './email.service';

export async function sendAttendanceReminders(): Promise<void> {
  const today      = new Date();
  const dayOfMonth = today.getDate();

  if (dayOfMonth < 28) {
    console.log('[Reminder] Not last 3 days of month, skipping');
    return;
  }

  const year      = today.getFullYear();
  const month     = today.getMonth() + 1;
  const monthName = today.toLocaleString('en', { month: 'long' });

  console.log(`[Reminder] Sending attendance reminders for ${monthName} ${year}`);

  const [admins] = await pool.query<any[]>(`
    SELECT
      u.id,
      u.name,
      u.phone,
      u.gym_id,
      u.institution_id,
      i.name AS institution_name,
      i.slug AS institution_slug,
      g.name AS gym_name,
      COUNT(c.id) AS visit_count
    FROM users u
    JOIN institutions i ON u.institution_id = i.id
    JOIN gyms g ON u.gym_id = g.id
    LEFT JOIN checkins c ON c.gym_id = u.gym_id
      AND c.checked_in_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
      AND c.checked_in_at < DATE_FORMAT(
        DATE_ADD(NOW(), INTERVAL 1 MONTH), '%Y-%m-01')
    LEFT JOIN users member ON c.user_id = member.id
      AND member.institution_id = u.institution_id
    WHERE u.role = 'institution_admin'
      AND u.status = 'active'
      AND u.phone IS NOT NULL
      AND i.slug IS NOT NULL
    GROUP BY u.id
  `);

  for (const admin of admins) {
    try {
      const portalUrl = `gymmind.rw/institution/${admin.institution_slug}`;
      const message =
        `GymMind: Hi ${admin.name},\n` +
        `Your ${admin.institution_name} attendance report ` +
        `for ${monthName} ${year} is ready.\n` +
        `${admin.visit_count} visit(s) recorded at ${admin.gym_name}.\n` +
        `Download your report at: ${portalUrl}`;

      await sendSMS(admin.phone, message);

      console.log(
        `[Reminder] Sent to ${admin.name} (${admin.phone}) — ` +
        `${admin.institution_name}: ${admin.visit_count} visits`
      );
    } catch (e) {
      console.error(`[Reminder] Failed to send to ${admin.phone}:`, e);
    }
  }

  console.log(`[Reminder] Done — ${admins.length} admin(s) notified`);
}

export async function checkExpiringMemberships(): Promise<void> {
  // 3-day warning
  const [threeDayRows] = await pool.query<any[]>(`
    SELECT
      um.id,
      um.end_date,
      um.gym_id,
      u.name,
      u.phone,
      mp.name AS plan_name,
      g.name  AS gym_name
    FROM user_memberships um
    JOIN users           u  ON um.user_id  = u.id  AND u.gym_id  = um.gym_id
    JOIN membership_plans mp ON um.plan_id  = mp.id AND mp.gym_id = um.gym_id
    JOIN gyms            g  ON um.gym_id   = g.id
    WHERE um.status = 'active'
      AND DATE(um.end_date) = DATE(DATE_ADD(NOW(), INTERVAL 3 DAY))
      AND u.phone IS NOT NULL
  `);

  for (const m of threeDayRows) {
    try {
      await sendSMS(
        m.phone,
        `GymMind: Reminder — ${m.gym_name}\nYour ${m.plan_name} membership expires in 3 days (${m.end_date}).\nRenew now to avoid interruption.\nVisit the gym check-in screen to renew.`,
      );
      console.log(`[Expiry] 3-day warning sent to ${m.phone} for membership ${m.id}`);
    } catch (e) {
      console.error(`[Expiry] Failed to send 3-day warning to ${m.phone}:`, e);
    }
  }

  // 1-day warning
  const [oneDayRows] = await pool.query<any[]>(`
    SELECT
      um.id,
      um.end_date,
      um.gym_id,
      u.name,
      u.phone,
      mp.name AS plan_name,
      g.name  AS gym_name
    FROM user_memberships um
    JOIN users           u  ON um.user_id  = u.id  AND u.gym_id  = um.gym_id
    JOIN membership_plans mp ON um.plan_id  = mp.id AND mp.gym_id = um.gym_id
    JOIN gyms            g  ON um.gym_id   = g.id
    WHERE um.status = 'active'
      AND DATE(um.end_date) = DATE(DATE_ADD(NOW(), INTERVAL 1 DAY))
      AND u.phone IS NOT NULL
  `);

  for (const m of oneDayRows) {
    try {
      await sendSMS(
        m.phone,
        `GymMind: Reminder — ${m.gym_name}\nYour ${m.plan_name} membership expires TOMORROW (${m.end_date}).\nRenew now to avoid interruption.\nVisit the gym check-in screen to renew.`,
      );
      console.log(`[Expiry] 1-day warning sent to ${m.phone} for membership ${m.id}`);
    } catch (e) {
      console.error(`[Expiry] Failed to send 1-day warning to ${m.phone}:`, e);
    }
  }
}

export async function sendMonthlyGymSummaries(): Promise<void> {
  const today = new Date();
  if (today.getDate() !== 1) {
    console.log('[Monthly] Not 1st of month, skipping gym summaries');
    return;
  }

  // Last month range
  const lastMonth      = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthStart = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`;
  const thisMonthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const monthName      = lastMonth.toLocaleString('en', { month: 'long', year: 'numeric' });

  console.log(`[Monthly] Sending gym summary emails for ${monthName}`);

  const [gyms] = await pool.query<any[]>(`
    SELECT
      g.id,
      g.name,
      g.slug,
      g.email,
      COUNT(DISTINCT c.id)                                          AS total_checkins,
      COUNT(DISTINCT CASE WHEN um.status = 'active' THEN um.id END) AS active_members,
      COALESCE(SUM(p.amount), 0)                                    AS total_revenue
    FROM gyms g
    LEFT JOIN checkins c
      ON c.gym_id = g.id
      AND c.checked_in_at >= ?
      AND c.checked_in_at <  ?
    LEFT JOIN user_memberships um
      ON um.gym_id = g.id
    LEFT JOIN payments p
      ON p.gym_id = g.id
      AND p.paid_at >= ?
      AND p.paid_at <  ?
      AND p.status = 'completed'
    WHERE g.email IS NOT NULL
    GROUP BY g.id
  `, [lastMonthStart, thisMonthStart, lastMonthStart, thisMonthStart]);

  for (const gym of gyms) {
    try {
      await sendMonthlyReport({
        to:            gym.email,
        gymName:       gym.name,
        gymSlug:       gym.slug,
        month:         monthName,
        totalCheckins: Number(gym.total_checkins),
        activeMembers: Number(gym.active_members),
        totalRevenue:  Number(gym.total_revenue),
      });
      console.log(`[Monthly] Summary sent to ${gym.email} (${gym.name})`);
    } catch (e) {
      console.error(`[Monthly] Failed to send to ${gym.email}:`, e);
    }
  }

  console.log(`[Monthly] Done — ${gyms.length} gym(s) emailed`);
}
