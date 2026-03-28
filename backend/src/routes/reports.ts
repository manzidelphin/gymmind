import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { resolveGym } from '../middleware/gym.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

router.use(resolveGym, authenticate, requireRole('gym_owner', 'gym_manager'));

// ---------------------------------------------------------------
// GET /api/reports/attendance
// Check-ins grouped by date, broken down by type.
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&institutionId=
// Always WHERE gym_id = req.gym.id.
// ---------------------------------------------------------------
router.get('/attendance', async (req: Request, res: Response) => {
  const gymId = req.gym.id;

  // Default to last 30 days if no range provided
  const from          = (req.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to            = (req.query.to   as string) || new Date().toISOString().slice(0, 10);
  const institutionId = req.query.institutionId as string | undefined;

  const params: unknown[] = [gymId, from, to];

  // Optional institution filter — join to users to get institution_id
  let institutionJoin  = '';
  let institutionWhere = '';
  if (institutionId) {
    institutionJoin  = 'JOIN users u ON u.id = c.user_id AND u.gym_id = c.gym_id';
    institutionWhere = 'AND u.institution_id = ?';
    params.push(parseInt(institutionId));
  }

  const [rows] = await pool.query<any[]>(
    `SELECT
       DATE(c.checked_in_at)                                      AS date,
       COUNT(*)                                                    AS total,
       SUM(c.checkin_type = 'institutional')                      AS institutional,
       SUM(c.checkin_type = 'individual')                         AS individual,
       SUM(c.checkin_type = 'dependent')                          AS dependent
     FROM checkins c
     ${institutionJoin}
     WHERE c.gym_id = ?
       AND DATE(c.checked_in_at) BETWEEN ? AND ?
       ${institutionWhere}
     GROUP BY DATE(c.checked_in_at)
     ORDER BY date ASC`,
    params
  );

  // Service breakdown per date
  const serviceParams: unknown[] = [gymId, from, to];
  if (institutionId) serviceParams.push(parseInt(institutionId));

  const [serviceRows] = await pool.query<any[]>(
    `SELECT DATE(c.checked_in_at) AS date, s.id AS service_id, s.name AS service_name, COUNT(*) AS count
     FROM checkins c
     LEFT JOIN services s ON c.service_id = s.id AND s.gym_id = c.gym_id
     ${institutionJoin}
     WHERE c.gym_id = ?
       AND DATE(c.checked_in_at) BETWEEN ? AND ?
       ${institutionWhere}
     GROUP BY DATE(c.checked_in_at), c.service_id
     ORDER BY date ASC`,
    serviceParams
  );

  res.json({ data: rows, serviceBreakdown: serviceRows, from, to });
});

// ---------------------------------------------------------------
// GET /api/reports/memberships
// Summary counts for the manager dashboard stat cards.
// Always WHERE gym_id = req.gym.id.
// ---------------------------------------------------------------
router.get('/memberships', async (req: Request, res: Response) => {
  const gymId = req.gym.id;

  // Active memberships
  const [[{ active }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS active
     FROM user_memberships
     WHERE gym_id = ? AND status = 'active'`,
    [gymId]
  );

  // Expired memberships
  const [[{ expired }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS expired
     FROM user_memberships
     WHERE gym_id = ? AND status = 'expired'`,
    [gymId]
  );

  // Expiring within 7 days (time-based only)
  const [[{ expiring_soon }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS expiring_soon
     FROM user_memberships um
     JOIN membership_plans mp ON mp.id = um.plan_id AND mp.gym_id = um.gym_id
     WHERE um.gym_id = ?
       AND um.status = 'active'
       AND mp.type = 'time_based'
       AND um.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)`,
    [gymId]
  );

  // Members with no membership at all
  const [[{ no_membership }]] = await pool.query<any[]>(
    `SELECT COUNT(*) AS no_membership
     FROM users u
     WHERE u.gym_id = ?
       AND u.role = 'member'
       AND NOT EXISTS (
         SELECT 1 FROM user_memberships um
         WHERE um.user_id = u.id AND um.gym_id = ? AND um.status = 'active'
       )`,
    [gymId, gymId]
  );

  res.json({
    active:        Number(active),
    expired:       Number(expired),
    expiring_soon: Number(expiring_soon),
    no_membership: Number(no_membership),
  });
});

// ---------------------------------------------------------------
// GET /api/reports/institution-billing?institutionId=&from=&to=
// Per-member attendance breakdown for an institution in a date range.
// Returns each member's check-ins + billing total based on rate_per_session.
// ---------------------------------------------------------------
router.get('/institution-billing', async (req: Request, res: Response) => {
  const gymId = req.gym.id;
  const institutionId = parseInt(req.query.institutionId as string);
  const from = (req.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to   = (req.query.to   as string) || new Date().toISOString().slice(0, 10);

  if (!institutionId) {
    res.status(400).json({ error: 'institutionId is required' });
    return;
  }

  const [instRows] = await pool.query<any[]>(
    'SELECT id, name, rate_per_session FROM institutions WHERE id = ? AND gym_id = ?',
    [institutionId, gymId]
  );
  if (!instRows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }
  const institution = instRows[0];
  const rate = Number(institution.rate_per_session);

  // Per-member visit count — direct members AND their dependents
  const [memberRows] = await pool.query<any[]>(
    `SELECT
       u.id,
       u.name,
       u.parent_id,
       p.name AS parent_name,
       COUNT(c.id) AS visit_count,
       GROUP_CONCAT(
         DATE_FORMAT(c.checked_in_at, '%Y-%m-%d %H:%i')
         ORDER BY c.checked_in_at ASC
         SEPARATOR ','
       ) AS visit_dates
     FROM users u
     LEFT JOIN users p ON p.id = u.parent_id AND p.gym_id = u.gym_id
     LEFT JOIN checkins c
       ON c.user_id = u.id AND c.gym_id = u.gym_id
       AND DATE(c.checked_in_at) BETWEEN ? AND ?
     WHERE u.gym_id = ?
       AND (u.institution_id = ? OR (u.parent_id IS NOT NULL AND p.institution_id = ?))
     GROUP BY u.id
     ORDER BY COALESCE(p.name, u.name), (u.parent_id IS NULL) DESC`,
    [from, to, gymId, institutionId, institutionId]
  );

  const totalVisits = memberRows.reduce((sum: number, r: any) => sum + Number(r.visit_count), 0);

  res.json({
    institution: { id: institution.id, name: institution.name, rate_per_session: rate },
    from,
    to,
    members: memberRows.map((r: any) => ({
      id:          r.id,
      name:        r.name,
      parent_name: r.parent_name ?? null,
      visit_count: Number(r.visit_count),
      amount_due:  Number(r.visit_count) * rate,
      visit_dates: r.visit_dates ? r.visit_dates.split(',') : [],
    })),
    total_visits: totalVisits,
    total_amount: totalVisits * rate,
  });
});

// ---------------------------------------------------------------
// GET /api/reports/institutions
// Monthly attendance grouped by institution and member.
// Query: ?month=YYYY-MM (default: current month)
// Always WHERE gym_id = req.gym.id.
// ---------------------------------------------------------------
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM');

router.get('/institutions', async (req: Request, res: Response) => {
  const gymId = req.gym.id;

  const monthParam = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const parsed = monthSchema.safeParse(monthParam);
  if (!parsed.success) {
    res.status(400).json({ error: 'month must be YYYY-MM format (e.g. 2026-03)' });
    return;
  }

  const [yearStr, monthStr] = parsed.data.split('-');
  const year  = parseInt(yearStr);
  const month = parseInt(monthStr);

  const monthLabel = new Date(year, month - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const [instRows] = await pool.query<any[]>(
    'SELECT id, name FROM institutions WHERE gym_id = ? ORDER BY name ASC',
    [gymId]
  );

  const institutions = [];
  for (const inst of instRows) {
    const [memberRows] = await pool.query<any[]>(
      `SELECT
         u.name,
         COUNT(c.id) AS visits
       FROM checkins c
       JOIN users u ON c.user_id = u.id
       WHERE c.gym_id = ?
         AND u.institution_id = ?
         AND YEAR(c.checked_in_at) = ?
         AND MONTH(c.checked_in_at) = ?
       GROUP BY u.id, u.name
       ORDER BY visits DESC`,
      [gymId, inst.id, year, month]
    );

    const members = memberRows.map((r: any) => ({ name: r.name, visits: Number(r.visits) }));
    const total_visits = members.reduce((sum, m) => sum + m.visits, 0);

    institutions.push({ id: inst.id, name: inst.name, members, total_visits });
  }

  res.json({ month: monthLabel, institutions });
});

// ---------------------------------------------------------------
// GET /api/reports/walkin
// Walk-in day pass revenue summary and daily breakdown.
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
// ---------------------------------------------------------------
router.get('/walkin', async (req: Request, res: Response) => {
  const gymId = req.gym.id;
  const from  = (req.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to    = (req.query.to   as string) || new Date().toISOString().slice(0, 10);

  const [[totals]] = await pool.query<any[]>(
    `SELECT
       COUNT(*)            AS total_payments,
       SUM(total_amount)   AS total_revenue,
       COUNT(DISTINCT DATE(created_at)) AS active_days
     FROM walkin_payments
     WHERE gym_id = ? AND status = 'successful'
       AND DATE(created_at) BETWEEN ? AND ?`,
    [gymId, from, to]
  );

  const [daily] = await pool.query<any[]>(
    `SELECT
       DATE(created_at) AS date,
       COUNT(*)         AS payments,
       SUM(total_amount) AS revenue
     FROM walkin_payments
     WHERE gym_id = ? AND status = 'successful'
       AND DATE(created_at) BETWEEN ? AND ?
     GROUP BY DATE(created_at)
     ORDER BY date ASC`,
    [gymId, from, to]
  );

  const [topServices] = await pool.query<any[]>(
    `SELECT s.name, COUNT(*) AS count, SUM(wps.price) AS revenue
     FROM walkin_payment_services wps
     JOIN walkin_payments wp ON wp.id = wps.walkin_payment_id
     JOIN services s ON s.id = wps.service_id
     WHERE wp.gym_id = ? AND wp.status = 'successful'
       AND DATE(wp.created_at) BETWEEN ? AND ?
     GROUP BY s.id, s.name
     ORDER BY count DESC`,
    [gymId, from, to]
  );

  res.json({
    from,
    to,
    total_payments: Number(totals.total_payments ?? 0),
    total_revenue:  Number(totals.total_revenue  ?? 0),
    active_days:    Number(totals.active_days    ?? 0),
    daily:          daily.map((r: any) => ({ date: r.date, payments: Number(r.payments), revenue: Number(r.revenue) })),
    top_services:   topServices.map((r: any) => ({ name: r.name, count: Number(r.count), revenue: Number(r.revenue) })),
  });
});

// ---------------------------------------------------------------
// GET /api/reports/today-checkins
// All check-ins + successful walk-in payments in the last 24 hours.
// ---------------------------------------------------------------
router.get('/today-checkins', async (req: Request, res: Response) => {
  const gymId = req.gym.id;

  const [rows] = await pool.query<any[]>(
    `SELECT
       c.id,
       c.checked_in_at,
       c.checkin_type,
       COALESCE(u.name,  'Walk-in')      AS member_name,
       COALESCE(u.phone, c.payer_phone)  AS member_phone,
       s.name                            AS service_name,
       i.name                            AS institution_name,
       parent.name                       AS parent_name
     FROM checkins c
     LEFT JOIN users u        ON c.user_id          = u.id        AND u.gym_id      = ?
     LEFT JOIN services s     ON c.service_id        = s.id
     LEFT JOIN institutions i ON u.institution_id    = i.id        AND i.gym_id      = ?
     LEFT JOIN users parent   ON u.parent_id         = parent.id   AND parent.gym_id = ?
     WHERE c.gym_id = ?
       AND DATE(c.checked_in_at) = CURDATE()
     ORDER BY c.checked_in_at DESC
     LIMIT 100`,
    [gymId, gymId, gymId, gymId],
  );

  res.json({
    checkins: rows.map((r: any) => ({
      id:               r.id,
      checked_in_at:    r.checked_in_at,
      checkin_type:     r.checkin_type,
      member_name:      r.member_name  ?? null,
      member_phone:     r.member_phone ?? null,
      service_name:     r.service_name ?? null,
      institution_name: r.institution_name ?? null,
      parent_name:      r.parent_name  ?? null,
    })),
  });
});

// ---------------------------------------------------------------
// GET /api/reports/recent-activity
// Recent check-ins, walk-in payments, and membership requests.
// Query: ?since=ISO_TIMESTAMP (default: last 30 seconds)
// ---------------------------------------------------------------
router.get('/recent-activity', async (req: Request, res: Response) => {
  const gymId = req.gym.id;
  const since = (req.query.since as string)
    || new Date(Date.now() - 30000).toISOString();

  const [rows] = await pool.query<any[]>(
    `SELECT
       'checkin'          AS type,
       c.id,
       c.checked_in_at    AS timestamp,
       u.name             AS member_name,
       u.phone            AS member_phone,
       s.name             AS service_name,
       c.checkin_type,
       NULL               AS amount
     FROM checkins c
     JOIN users u ON c.user_id = u.id AND u.gym_id = c.gym_id
     LEFT JOIN services s ON c.service_id = s.id
     WHERE c.gym_id = ? AND c.checked_in_at > ?

     UNION ALL

     SELECT
       'walkin'           AS type,
       wp.id,
       wp.created_at      AS timestamp,
       'Walk-in'          AS member_name,
       wp.payer_phone     AS member_phone,
       (SELECT GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ')
        FROM walkin_payment_services wps2
        JOIN services s ON s.id = wps2.service_id
        WHERE wps2.walkin_payment_id = wp.id
          AND wps2.gym_id = wp.gym_id
       )                  AS service_name,
       'walkin'           AS checkin_type,
       wp.total_amount    AS amount
     FROM walkin_payments wp
     WHERE wp.gym_id = ? AND wp.status = 'successful'
       AND wp.created_at > ?

     UNION ALL

     SELECT
       'membership_request' AS type,
       mr.id,
       mr.requested_at      AS timestamp,
       u.name               AS member_name,
       u.phone              AS member_phone,
       mp.name              AS service_name,
       'request'            AS checkin_type,
       NULL                 AS amount
     FROM membership_requests mr
     JOIN users u  ON mr.user_id  = u.id  AND u.gym_id  = ?
     JOIN membership_plans mp ON mr.plan_id = mp.id AND mp.gym_id = ?
     WHERE mr.gym_id = ? AND mr.status = 'pending'
       AND mr.requested_at > ?

     ORDER BY timestamp DESC
     LIMIT 20`,
    [gymId, since, gymId, since, gymId, gymId, gymId, since],
  );

  res.json({
    events: rows.map((r: any) => ({
      type:         r.type,
      id:           r.id,
      timestamp:    r.timestamp,
      member_name:  r.member_name,
      member_phone: r.member_phone,
      service_name: r.service_name ?? null,
      checkin_type: r.checkin_type,
      amount:       r.amount != null ? Number(r.amount) : null,
    })),
  });
});

export default router;
