/**
 * INSTITUTION PORTAL ROUTES
 * All require a valid JWT with role = 'institution_admin'.
 * All queries are scoped to institution_id AND gym_id from the JWT.
 * Institution admins can never see data from other institutions.
 *
 * GET /api/institution/me          — institution + gym info
 * GET /api/institution/members     — all members of this institution
 * GET /api/institution/attendance  — monthly attendance (?month=YYYY-MM)
 */
import { Router, Request, Response } from 'express';
import { pool } from '../config/db';

const router = Router();

// All routes require institution_admin role
router.use((req: Request, res: Response, next) => {
  if (!req.user || req.user.role !== 'institution_admin') {
    res.status(403).json({ error: 'Institution admin access required' });
    return;
  }
  next();
});

// ---------------------------------------------------------------
// GET /api/institution/me
// ---------------------------------------------------------------
router.get('/me', async (req: Request, res: Response) => {
  const institutionId = req.user.institution_id;
  const gymId         = req.user.gym_id!;

  const [rows] = await pool.query<any[]>(
    `SELECT i.*, g.name AS gym_name, g.slug AS gym_slug
     FROM institutions i
     JOIN gyms g ON i.gym_id = g.id
     WHERE i.id = ? AND i.gym_id = ?`,
    [institutionId, gymId]
  );

  if (!rows[0]) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }

  res.json(rows[0]);
});

// ---------------------------------------------------------------
// GET /api/institution/members
// ---------------------------------------------------------------
router.get('/members', async (req: Request, res: Response) => {
  const institutionId = req.user.institution_id;
  const gymId         = req.user.gym_id!;

  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.name, u.status,
            u.parent_id, parent.name AS parent_name,
            COUNT(c.id) AS total_checkins
     FROM users u
     LEFT JOIN users parent ON u.parent_id = parent.id
       AND parent.gym_id = ?
     LEFT JOIN checkins c ON c.user_id = u.id
       AND c.gym_id = ?
     WHERE u.institution_id = ?
       AND u.gym_id = ?
     GROUP BY u.id
     ORDER BY u.name ASC`,
    [gymId, gymId, institutionId, gymId]
  );

  res.json(rows);
});

// ---------------------------------------------------------------
// GET /api/institution/attendance?month=YYYY-MM
// ---------------------------------------------------------------
router.get('/attendance', async (req: Request, res: Response) => {
  const institutionId = req.user.institution_id;
  const gymId         = req.user.gym_id!;

  // Default to current month
  const now   = new Date();
  const month = (req.query.month as string) || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [yearStr, monthStr] = month.split('-');
  const year  = parseInt(yearStr);
  const mon   = parseInt(monthStr);

  if (isNaN(year) || isNaN(mon) || mon < 1 || mon > 12) {
    res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    return;
  }

  const [rows] = await pool.query<any[]>(
    `SELECT
       u.id AS user_id,
       u.name,
       parent.name AS parent_name,
       u.parent_id,
       u.status,
       COUNT(c.id) AS visit_count,
       GROUP_CONCAT(
         DATE_FORMAT(c.checked_in_at, '%d %b %Y %H:%i')
         ORDER BY c.checked_in_at DESC
         SEPARATOR '|'
       ) AS visit_dates
     FROM users u
     LEFT JOIN users parent ON u.parent_id = parent.id
       AND parent.gym_id = ?
     LEFT JOIN checkins c ON c.user_id = u.id
       AND c.gym_id = ?
       AND YEAR(c.checked_in_at) = ?
       AND MONTH(c.checked_in_at) = ?
     WHERE u.institution_id = ?
       AND u.gym_id = ?
     GROUP BY u.id
     ORDER BY visit_count DESC`,
    [gymId, gymId, year, mon, institutionId, gymId]
  );

  // Per-user per-service breakdown
  const [serviceCheckins] = await pool.query<any[]>(
    `SELECT c.user_id, c.service_id, s.name AS service_name, COUNT(*) AS cnt
     FROM checkins c
     LEFT JOIN services s ON c.service_id = s.id AND s.gym_id = c.gym_id
     WHERE c.gym_id = ?
       AND YEAR(c.checked_in_at) = ?
       AND MONTH(c.checked_in_at) = ?
       AND c.user_id IN (
         SELECT id FROM users WHERE institution_id = ? AND gym_id = ?
       )
     GROUP BY c.user_id, c.service_id`,
    [gymId, year, mon, institutionId, gymId]
  );

  // Build map: userId -> { serviceId -> count }
  const breakdownMap = new Map<number, Record<string, number>>();
  for (const sc of serviceCheckins) {
    if (!breakdownMap.has(sc.user_id)) breakdownMap.set(sc.user_id, {});
    const key = sc.service_id !== null ? String(sc.service_id) : 'null';
    breakdownMap.get(sc.user_id)![key] = Number(sc.cnt);
  }

  // Collect distinct services used this month
  const servicesMap = new Map<string, string>();
  for (const sc of serviceCheckins) {
    if (sc.service_id !== null) {
      servicesMap.set(String(sc.service_id), sc.service_name ?? `Service ${sc.service_id}`);
    }
  }
  const services = Array.from(servicesMap.entries()).map(([id, name]) => ({ id: parseInt(id), name }));

  const data = rows.map((r: any) => ({
    ...r,
    service_breakdown: breakdownMap.get(r.user_id) ?? {},
  }));

  // Billing summary for this institution + month
  const [[instRow]] = await pool.query<any[]>(
    'SELECT rate_per_session FROM institutions WHERE id = ? AND gym_id = ?',
    [institutionId, gymId],
  );
  const rate         = instRow ? Number(instRow.rate_per_session) : 0;
  const totalVisits  = rows.reduce((n: number, r: any) => n + Number(r.visit_count), 0);

  const [billingRows] = await pool.query<any[]>(
    `SELECT status, paid_at, total_amount, payment_reference
     FROM institutional_payments
     WHERE institution_id = ? AND gym_id = ? AND month = ?`,
    [institutionId, gymId, month],
  );
  const billingRecord = billingRows[0] ?? null;

  const billing = {
    rate_per_session:  rate,
    total_visits:      totalVisits,
    calculated_amount: totalVisits * rate,
    payment_status:    billingRecord?.status           ?? null,
    paid_at:           billingRecord?.paid_at          ?? null,
    paid_amount:       billingRecord?.total_amount != null ? Number(billingRecord.total_amount) : null,
    payment_reference: billingRecord?.payment_reference ?? null,
  };

  res.json({ data, month, services, billing });
});

export default router;
