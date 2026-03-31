import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { normalizePhone, validatePhone } from '../utils/phone';
import { generateOTP, saveOTP, sendOTP, verifyOTP } from '../services/otp.service';
import { signToken, verifyToken } from '../services/jwt.service';
import { env } from '../config/env';
import { generateInvoicePdf } from '../services/invoice.service';

const router = Router();

// ---------------------------------------------------------------
// Shared helper: resolve gym + institution from an HR token.
// Token is either an invoice access_token or an institution slug.
// ---------------------------------------------------------------
interface ResolvedInst {
  gymId:           number;
  institutionId:   number;
  institutionName: string;
  gymName:         string;
  ratePerSession:  number;
}

async function resolveInstitution(token: string): Promise<ResolvedInst | null> {
  const [payRows] = await pool.query<any[]>(
    `SELECT ip.institution_id, ip.gym_id,
            i.name AS institution_name, i.rate_per_session,
            g.name AS gym_name
     FROM institutional_payments ip
     JOIN institutions i ON i.id = ip.institution_id
     JOIN gyms g ON g.id = ip.gym_id
     WHERE ip.access_token = ? LIMIT 1`,
    [token],
  );
  if (payRows[0]) {
    return {
      gymId:           payRows[0].gym_id,
      institutionId:   payRows[0].institution_id,
      institutionName: payRows[0].institution_name,
      gymName:         payRows[0].gym_name,
      ratePerSession:  Number(payRows[0].rate_per_session),
    };
  }

  const [instRows] = await pool.query<any[]>(
    `SELECT i.id, i.name, i.rate_per_session, i.gym_id, g.name AS gym_name
     FROM institutions i JOIN gyms g ON g.id = i.gym_id
     WHERE i.slug = ? LIMIT 1`,
    [token],
  );
  if (instRows[0]) {
    return {
      gymId:           instRows[0].gym_id,
      institutionId:   instRows[0].id,
      institutionName: instRows[0].name,
      gymName:         instRows[0].gym_name,
      ratePerSession:  Number(instRows[0].rate_per_session),
    };
  }
  return null;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------
// HR Admin Auth middleware
// ---------------------------------------------------------------
interface HrPayload {
  phone:          string;
  institutionIds: number[];
}

function hrAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const payload = verifyToken(auth.slice(7));
    if (payload.role !== 'institution_admin') {
      res.status(403).json({ error: 'HR access only' });
      return;
    }
    (req as any).hrPayload = {
      phone:          payload.phone,
      institutionIds: payload.institutionIds ?? [],
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ---------------------------------------------------------------
// POST /api/hr/auth/send-otp
// Body: { phone }
// ---------------------------------------------------------------
const hrSendOtpSchema = z.object({ phone: z.string().min(9) });

router.post('/auth/send-otp', async (req: Request, res: Response) => {
  const parsed = hrSendOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid phone number' });
    return;
  }

  let phone: string;
  try {
    phone = normalizePhone(parsed.data.phone);
    if (!validatePhone(phone)) throw new Error();
  } catch {
    res.status(400).json({ error: 'Invalid phone number format' });
    return;
  }

  const [rows] = await pool.query<any[]>(
    `SELECT id FROM users WHERE phone = ? AND role = 'institution_admin' LIMIT 1`,
    [phone],
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'No HR admin account found for this phone number' });
    return;
  }

  const code = generateOTP();
  await saveOTP(null, phone, code);
  await sendOTP(phone, code);

  const response: Record<string, unknown> = { message: 'OTP sent' };
  if (env.NODE_ENV !== 'production') response.devCode = code;
  res.json(response);
});

// ---------------------------------------------------------------
// POST /api/hr/auth/verify-otp
// Body: { phone, code }
// ---------------------------------------------------------------
const hrVerifyOtpSchema = z.object({
  phone: z.string().min(9),
  code:  z.string().length(6),
});

router.post('/auth/verify-otp', async (req: Request, res: Response) => {
  const parsed = hrVerifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  let phone: string;
  try {
    phone = normalizePhone(parsed.data.phone);
    if (!validatePhone(phone)) throw new Error();
  } catch {
    res.status(400).json({ error: 'Invalid phone number format' });
    return;
  }

  const valid = await verifyOTP(null, phone, parsed.data.code);
  if (!valid) {
    res.status(400).json({ error: 'Invalid or expired code' });
    return;
  }

  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.name, u.institution_id,
            i.name AS institution_name, i.gym_id,
            g.name AS gym_name, g.slug AS gym_slug
     FROM users u
     JOIN institutions i ON i.id = u.institution_id AND i.gym_id = u.gym_id
     JOIN gyms g ON g.id = u.gym_id
     WHERE u.phone = ? AND u.role = 'institution_admin'`,
    [phone],
  );

  if (!rows[0]) {
    res.status(404).json({ error: 'No HR admin account found' });
    return;
  }

  const institutionIds = rows.map((r: any) => r.institution_id);
  const primary = rows[0];

  const token = signToken({
    userId:         primary.id,
    gymId:          null,
    role:           'institution_admin',
    phone,
    institutionIds,
  });

  res.json({
    token,
    hrAdmin: {
      name:  primary.name,
      phone,
      institutions: rows.map((r: any) => ({
        id:       r.institution_id,
        name:     r.institution_name,
        gymId:    r.gym_id,
        gymName:  r.gym_name,
        gymSlug:  r.gym_slug,
      })),
    },
  });
});

// ---------------------------------------------------------------
// GET /api/hr/dashboard
// Returns all gyms/institutions this HR admin manages with
// current-month billing summary.
// ---------------------------------------------------------------
router.get('/dashboard', hrAuth, async (req: Request, res: Response) => {
  const { phone } = (req as any).hrPayload as HrPayload;
  const month = currentMonth();

  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.institution_id, u.gym_id,
            i.name AS institution_name, i.rate_per_session,
            g.name AS gym_name, g.slug AS gym_slug
     FROM users u
     JOIN institutions i ON i.id = u.institution_id AND i.gym_id = u.gym_id
     JOIN gyms g ON g.id = u.gym_id
     WHERE u.phone = ? AND u.role = 'institution_admin'`,
    [phone],
  );

  const results = await Promise.all(rows.map(async (r: any) => {
    const gymId         = r.gym_id;
    const institutionId = r.institution_id;
    const ratePS        = Number(r.rate_per_session);

    const [[empRow]] = await pool.query<any[]>(
      `SELECT COUNT(id) AS cnt FROM users
       WHERE gym_id = ? AND institution_id = ? AND role = 'member'`,
      [gymId, institutionId],
    );

    const [visitRows] = await pool.query<any[]>(
      `SELECT u.id, COUNT(DISTINCT DATE(c.checked_in_at)) AS days_attended
       FROM users u
       LEFT JOIN checkins c
         ON c.user_id = u.id AND c.gym_id = u.gym_id
         AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
       WHERE u.gym_id = ? AND u.institution_id = ? AND u.role = 'member'
       GROUP BY u.id`,
      [month, gymId, institutionId],
    );

    const totalVisits   = visitRows.reduce((s: number, v: any) => s + Number(v.days_attended), 0);
    const invoiceAmount = totalVisits * ratePS;

    const [[invoice]] = await pool.query<any[]>(
      `SELECT id, status, access_token, total_amount
       FROM institutional_payments
       WHERE gym_id = ? AND institution_id = ? AND month = ?`,
      [gymId, institutionId, month],
    );

    return {
      gymId,
      gymName:       r.gym_name,
      gymSlug:       r.gym_slug,
      institutionId,
      institutionName: r.institution_name,
      ratePerSession:  ratePS,
      employeeCount:   Number(empRow.cnt),
      thisMonthVisits: totalVisits,
      invoiceAmount,
      invoiceStatus:   invoice?.status       ?? null,
      invoiceToken:    invoice?.access_token ?? null,
      invoiceId:       invoice?.id           ?? null,
      month,
    };
  }));

  res.json(results);
});

// ---------------------------------------------------------------
// GET /api/hr/gym/:gymSlug/institution/:institutionId
// Auth-based full detail for one gym (mirror of /:token).
// ---------------------------------------------------------------
router.get('/gym/:gymSlug/institution/:institutionId', hrAuth, async (req: Request, res: Response) => {
  const { institutionIds } = (req as any).hrPayload as HrPayload;
  const institutionId      = parseInt(req.params.institutionId);
  const gymSlug            = req.params.gymSlug;

  if (!institutionIds.includes(institutionId)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const [gymRows] = await pool.query<any[]>(
    `SELECT id, name FROM gyms WHERE slug = ?`,
    [gymSlug],
  );
  if (!gymRows[0]) { res.status(404).json({ error: 'Gym not found' }); return; }
  const gymId = gymRows[0].id;

  const [instRows] = await pool.query<any[]>(
    `SELECT id, name, rate_per_session FROM institutions WHERE id = ? AND gym_id = ?`,
    [institutionId, gymId],
  );
  if (!instRows[0]) { res.status(404).json({ error: 'Institution not found' }); return; }

  const ratePS = Number(instRows[0].rate_per_session);
  const month  = currentMonth();

  const [[ipRow]] = await pool.query<any[]>(
    `SELECT status, paid_at, payment_reference, total_amount FROM institutional_payments
     WHERE institution_id = ? AND gym_id = ? AND month = ?`,
    [institutionId, gymId, month],
  );

  const [empRows] = await pool.query<any[]>(
    `SELECT u.id, u.name, u.phone, u.status,
            COUNT(DISTINCT DATE(c.checked_in_at)) AS days_attended,
            MAX(c.checked_in_at)                  AS last_checkin
     FROM users u
     LEFT JOIN checkins c
       ON c.user_id = u.id AND c.gym_id = u.gym_id
       AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
     WHERE u.gym_id = ? AND u.institution_id = ? AND u.role = 'member' AND u.parent_id IS NULL
     GROUP BY u.id, u.name, u.phone, u.status
     ORDER BY u.name ASC`,
    [month, gymId, institutionId],
  );

  const employees = empRows.map((r: any) => ({
    id:            r.id,
    name:          r.name,
    phone:         r.phone        ?? null,
    status:        r.status,
    days_attended: Number(r.days_attended),
    amount:        Number(r.days_attended) * ratePS,
    last_checkin:  r.last_checkin ?? null,
  }));

  res.json({
    gym_name:   gymRows[0].name,
    institution: { id: institutionId, name: instRows[0].name, rate_per_session: ratePS },
    month,
    employees,
    total:             employees.reduce((s, e) => s + e.amount, 0),
    payment_status:    ipRow?.status             ?? null,
    paid_at:           ipRow?.paid_at            ?? null,
    payment_reference: ipRow?.payment_reference  ?? null,
    total_paid:        ipRow?.total_amount != null ? Number(ipRow.total_amount) : null,
  });
});

// ---------------------------------------------------------------
// GET /api/hr/:token/invoice.pdf
// Streams a professional PDF invoice for the given HR token.
// ---------------------------------------------------------------
router.get('/:token/invoice.pdf', async (req: Request, res: Response) => {
  const token = req.params.token;

  try {
    // Resolve via access_token (invoice) first
    const [payRows] = await pool.query<any[]>(
      `SELECT ip.*,
              i.name  AS institution_name, i.rate_per_session,
              i.gym_id, g.name AS gym_name
       FROM institutional_payments ip
       JOIN institutions i ON i.id = ip.institution_id
       JOIN gyms g ON g.id = ip.gym_id
       WHERE ip.access_token = ? LIMIT 1`,
      [token],
    );

    let gymName: string;
    let institutionName: string;
    let ratePerSession: number;
    let month: string;
    let gymId: number;
    let institutionId: number;
    let paymentStatus: string | null;
    let paidAt: string | null;
    let paymentRef: string | null;

    if (payRows[0]) {
      const row  = payRows[0];
      gymName         = row.gym_name;
      institutionName = row.institution_name;
      ratePerSession  = Number(row.rate_per_session);
      month           = row.month as string;
      gymId           = row.gym_id;
      institutionId   = row.institution_id;
      paymentStatus   = row.status   ?? null;
      paidAt          = row.paid_at  ?? null;
      paymentRef      = row.payment_reference ?? null;
    } else {
      // Fallback: institution slug
      const [instRows] = await pool.query<any[]>(
        `SELECT i.id, i.name, i.rate_per_session, i.gym_id, g.name AS gym_name
         FROM institutions i JOIN gyms g ON g.id = i.gym_id
         WHERE i.slug = ? LIMIT 1`,
        [token],
      );
      if (!instRows[0]) { res.status(404).json({ error: 'Portal not found' }); return; }
      const inst  = instRows[0];
      gymName         = inst.gym_name;
      institutionName = inst.name;
      ratePerSession  = Number(inst.rate_per_session);
      month           = currentMonth();
      gymId           = inst.gym_id;
      institutionId   = inst.id;

      const [[ipRow]] = await pool.query<any[]>(
        `SELECT status, paid_at, payment_reference FROM institutional_payments
         WHERE institution_id = ? AND gym_id = ? AND month = ?`,
        [institutionId, gymId, month],
      );
      paymentStatus = ipRow?.status             ?? null;
      paidAt        = ipRow?.paid_at            ?? null;
      paymentRef    = ipRow?.payment_reference  ?? null;
    }

    // Fetch employees + attendance for the month
    const [empRows] = await pool.query<any[]>(
      `SELECT u.name,
              COUNT(DISTINCT DATE(c.checked_in_at)) AS days_attended
       FROM users u
       LEFT JOIN checkins c
         ON c.user_id = u.id AND c.gym_id = u.gym_id
         AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
       WHERE u.gym_id = ? AND u.institution_id = ? AND u.role = 'member' AND u.parent_id IS NULL
       GROUP BY u.id, u.name
       ORDER BY u.name ASC`,
      [month, gymId, institutionId],
    );

    const employees = empRows.map((r: any) => ({
      name:          r.name,
      days_attended: Number(r.days_attended),
      amount:        Number(r.days_attended) * ratePerSession,
    }));

    const total = employees.reduce((s, e) => s + e.amount, 0);

    const pdfBuffer = await generateInvoicePdf({
      gymName,
      institutionName,
      month,
      employees,
      total,
      ratePerSession,
      paymentStatus,
      paidAt,
      paymentRef,
      invoiceToken: token,
    });

    const filename = `${institutionName.replace(/\s+/g, '-')}-Invoice-${month}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (err) {
    console.error('Invoice PDF error:', err);
    res.status(500).json({ error: 'Failed to generate invoice' });
  }
});

// ---------------------------------------------------------------
// GET /api/hr/:token
// Public — invoice data + employees with phone + last check-in.
// ---------------------------------------------------------------
router.get('/:token', async (req: Request, res: Response) => {
  const token = req.params.token;

  try {
    // Try access_token (generated invoice) first
    const [payRows] = await pool.query<any[]>(
      `SELECT ip.*,
              i.name  AS institution_name, i.rate_per_session,
              i.gym_id, g.name AS gym_name
       FROM institutional_payments ip
       JOIN institutions i ON i.id = ip.institution_id
       JOIN gyms g ON g.id = ip.gym_id
       WHERE ip.access_token = ? LIMIT 1`,
      [token],
    );

    if (payRows[0]) {
      const row    = payRows[0];
      const gymId  = row.gym_id;
      const ratePS = Number(row.rate_per_session);
      const month  = row.month as string;

      const [empRows] = await pool.query<any[]>(
        `SELECT u.id, u.name, u.phone, u.status,
                COUNT(DISTINCT DATE(c.checked_in_at)) AS days_attended,
                MAX(c.checked_in_at)                  AS last_checkin
         FROM users u
         LEFT JOIN checkins c
           ON c.user_id = u.id AND c.gym_id = u.gym_id
           AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
         WHERE u.gym_id = ? AND u.institution_id = ? AND u.role = 'member' AND u.parent_id IS NULL
         GROUP BY u.id, u.name, u.phone, u.status
         ORDER BY u.name ASC`,
        [month, gymId, row.institution_id],
      );

      const employees = empRows.map((r: any) => ({
        id:            r.id,
        name:          r.name,
        phone:         r.phone         ?? null,
        status:        r.status,
        days_attended: Number(r.days_attended),
        amount:        Number(r.days_attended) * ratePS,
        last_checkin:  r.last_checkin  ?? null,
      }));

      const total = employees.reduce((s, e) => s + e.amount, 0);

      res.json({
        gym_name: row.gym_name,
        institution: { id: row.institution_id, name: row.institution_name, rate_per_session: ratePS },
        month,
        employees,
        total,
        payment_status:    row.status             ?? null,
        paid_at:           row.paid_at            ?? null,
        payment_reference: row.payment_reference  ?? null,
        total_paid:        row.total_amount != null ? Number(row.total_amount) : null,
        invoice_id:        row.id,
      });
      return;
    }

    // Fallback: institution slug
    const [instRows] = await pool.query<any[]>(
      `SELECT i.id, i.name, i.rate_per_session, i.gym_id, g.name AS gym_name
       FROM institutions i JOIN gyms g ON g.id = i.gym_id
       WHERE i.slug = ? LIMIT 1`,
      [token],
    );

    if (!instRows[0]) { res.status(404).json({ error: 'Portal not found' }); return; }

    const inst   = instRows[0];
    const gymId  = inst.gym_id;
    const ratePS = Number(inst.rate_per_session);
    const month  = currentMonth();

    const [ipRows] = await pool.query<any[]>(
      `SELECT status, paid_at, payment_reference, total_amount FROM institutional_payments
       WHERE institution_id = ? AND gym_id = ? AND month = ?`,
      [inst.id, gymId, month],
    );
    const payment = ipRows[0] ?? null;

    const [empRows] = await pool.query<any[]>(
      `SELECT u.id, u.name, u.phone, u.status,
              COUNT(DISTINCT DATE(c.checked_in_at)) AS days_attended,
              MAX(c.checked_in_at)                  AS last_checkin
       FROM users u
       LEFT JOIN checkins c
         ON c.user_id = u.id AND c.gym_id = u.gym_id
         AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
       WHERE u.gym_id = ? AND u.institution_id = ? AND u.role = 'member' AND u.parent_id IS NULL
       GROUP BY u.id, u.name, u.phone, u.status
       ORDER BY u.name ASC`,
      [month, gymId, inst.id],
    );

    const employees = empRows.map((r: any) => ({
      id:            r.id,
      name:          r.name,
      phone:         r.phone        ?? null,
      status:        r.status,
      days_attended: Number(r.days_attended),
      amount:        Number(r.days_attended) * ratePS,
      last_checkin:  r.last_checkin ?? null,
    }));

    res.json({
      gym_name: inst.gym_name,
      institution: { id: inst.id, name: inst.name, rate_per_session: ratePS },
      month,
      employees,
      total:             employees.reduce((s, e) => s + e.amount, 0),
      payment_status:    payment?.status            ?? null,
      paid_at:           payment?.paid_at           ?? null,
      payment_reference: payment?.payment_reference ?? null,
      total_paid:        payment?.total_amount != null ? Number(payment.total_amount) : null,
    });
  } catch (err) {
    console.error('HR portal error:', err);
    res.status(500).json({ error: 'Failed to load portal data' });
  }
});

// ---------------------------------------------------------------
// GET /api/hr/:token/attendance?month=YYYY-MM
// Returns per-employee attendance: which specific days they visited.
// ---------------------------------------------------------------
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);

router.get('/:token/attendance', async (req: Request, res: Response) => {
  const token      = req.params.token;
  const monthParam = (req.query.month as string) || currentMonth();

  if (!monthSchema.safeParse(monthParam).success) {
    res.status(400).json({ error: 'month must be YYYY-MM' });
    return;
  }

  try {
    const inst = await resolveInstitution(token);
    if (!inst) { res.status(404).json({ error: 'Portal not found' }); return; }

    const [rows] = await pool.query<any[]>(
      `SELECT u.id AS user_id, u.name,
              GROUP_CONCAT(DISTINCT DAY(c.checked_in_at) ORDER BY c.checked_in_at) AS days_raw,
              COUNT(DISTINCT DATE(c.checked_in_at)) AS total_days
       FROM users u
       LEFT JOIN checkins c
         ON c.user_id = u.id AND c.gym_id = u.gym_id
         AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
       WHERE u.gym_id = ? AND u.institution_id = ? AND u.role = 'member' AND u.parent_id IS NULL
       GROUP BY u.id, u.name
       ORDER BY u.name ASC`,
      [monthParam, inst.gymId, inst.institutionId],
    );

    const attendance = rows.map((r: any) => ({
      user_id:    r.user_id,
      name:       r.name,
      days:       r.days_raw ? r.days_raw.split(',').map(Number) : [],
      total_days: Number(r.total_days),
    }));

    res.json({ month: monthParam, attendance });
  } catch (err) {
    console.error('HR attendance error:', err);
    res.status(500).json({ error: 'Failed to load attendance' });
  }
});

// ---------------------------------------------------------------
// POST /api/hr/:token/employees
// Add a single employee to the institution.
// Body: { name, phone? }
// ---------------------------------------------------------------
const addEmployeeSchema = z.object({
  name:  z.string().min(1).max(255),
  phone: z.string().optional(),
});

router.post('/:token/employees', async (req: Request, res: Response) => {
  const token  = req.params.token;
  const parsed = addEmployeeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const inst = await resolveInstitution(token);
    if (!inst) { res.status(404).json({ error: 'Portal not found' }); return; }

    let phone: string | null = null;
    if (parsed.data.phone?.trim()) {
      try {
        phone = normalizePhone(parsed.data.phone.trim());
        if (!validatePhone(phone)) phone = null;
      } catch { phone = null; }

      if (phone) {
        const [dup] = await pool.query<any[]>(
          'SELECT id FROM users WHERE gym_id = ? AND phone = ?',
          [inst.gymId, phone],
        );
        if (dup[0]) {
          res.status(409).json({ error: 'Phone number already registered at this gym' });
          return;
        }
      }
    }

    const [result] = await pool.query<any>(
      `INSERT INTO users (gym_id, name, phone, role, institution_id, status)
       VALUES (?, ?, ?, 'member', ?, ?)`,
      [inst.gymId, parsed.data.name.trim(), phone, inst.institutionId, phone ? 'active' : 'unclaimed'],
    );

    const [[newUser]] = await pool.query<any[]>(
      'SELECT id, name, phone, status FROM users WHERE id = ?',
      [result.insertId],
    );

    res.status(201).json(newUser);
  } catch (err) {
    console.error('HR add employee error:', err);
    res.status(500).json({ error: 'Failed to add employee' });
  }
});

// ---------------------------------------------------------------
// POST /api/hr/:token/employees/bulk
// Add multiple employees from CSV parse.
// Body: { employees: [{ name, phone? }] }
// ---------------------------------------------------------------
const bulkSchema = z.object({
  employees: z.array(z.object({
    name:  z.string().min(1).max(255),
    phone: z.string().optional(),
  })).min(1).max(500),
});

router.post('/:token/employees/bulk', async (req: Request, res: Response) => {
  const token  = req.params.token;
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const inst = await resolveInstitution(token);
    if (!inst) { res.status(404).json({ error: 'Portal not found' }); return; }

    let created = 0, skipped = 0;
    const errors: string[] = [];

    for (const emp of parsed.data.employees) {
      try {
        let phone: string | null = null;
        if (emp.phone?.trim()) {
          try {
            phone = normalizePhone(emp.phone.trim());
            if (!validatePhone(phone)) phone = null;
          } catch { phone = null; }

          if (phone) {
            const [dup] = await pool.query<any[]>(
              'SELECT id FROM users WHERE gym_id = ? AND phone = ?',
              [inst.gymId, phone],
            );
            if (dup[0]) {
              skipped++;
              errors.push(`${emp.name}: phone already registered`);
              continue;
            }
          }
        }

        await pool.query(
          `INSERT INTO users (gym_id, name, phone, role, institution_id, status)
           VALUES (?, ?, ?, 'member', ?, ?)`,
          [inst.gymId, emp.name.trim(), phone, inst.institutionId, phone ? 'active' : 'unclaimed'],
        );
        created++;
      } catch {
        errors.push(`${emp.name}: failed to insert`);
      }
    }

    res.json({ created, skipped, errors });
  } catch (err) {
    console.error('HR bulk error:', err);
    res.status(500).json({ error: 'Bulk upload failed' });
  }
});

// ---------------------------------------------------------------
// DELETE /api/hr/:token/employees/:userId
// Remove an employee from the institution.
// ---------------------------------------------------------------
router.delete('/:token/employees/:userId', async (req: Request, res: Response) => {
  const token  = req.params.token;
  const userId = parseInt(req.params.userId);

  try {
    const inst = await resolveInstitution(token);
    if (!inst) { res.status(404).json({ error: 'Portal not found' }); return; }

    const [rows] = await pool.query<any[]>(
      `SELECT id FROM users WHERE id = ? AND gym_id = ? AND institution_id = ? AND role = 'member'`,
      [userId, inst.gymId, inst.institutionId],
    );
    if (!rows[0]) { res.status(404).json({ error: 'Employee not found' }); return; }

    await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ message: 'Employee removed' });
  } catch (err) {
    console.error('HR delete employee error:', err);
    res.status(500).json({ error: 'Failed to remove employee' });
  }
});

// ---------------------------------------------------------------
// POST /api/hr/:token/pay
// Initiate MoMo payment.
// Body: { hrName, momoPhone }
// ---------------------------------------------------------------
const paySchema = z.object({
  hrName:    z.string().min(1).max(255),
  momoPhone: z.string().min(9).max(20),
});

router.post('/:token/pay', async (req: Request, res: Response) => {
  const token  = req.params.token;
  const parsed = paySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const [payRows] = await pool.query<any[]>(
      `SELECT ip.id, ip.status, ip.total_amount FROM institutional_payments ip
       WHERE ip.access_token = ? LIMIT 1`,
      [token],
    );
    if (!payRows[0]) { res.status(404).json({ error: 'Invoice not found' }); return; }
    if (payRows[0].status === 'paid') { res.status(409).json({ error: 'Invoice already paid' }); return; }

    const ref = `MOMO-${Date.now()}-${parsed.data.momoPhone.replace(/\D/g, '').slice(-4)}`;

    await pool.query(
      `UPDATE institutional_payments SET payment_reference = ?, notes = ? WHERE id = ?`,
      [ref, `HR: ${parsed.data.hrName} | Phone: ${parsed.data.momoPhone}`, payRows[0].id],
    );

    res.json({
      message:   'Payment initiated. Approve the MoMo prompt on your phone.',
      reference: ref,
      amount:    Number(payRows[0].total_amount),
      phone:     parsed.data.momoPhone,
    });
  } catch (err) {
    console.error('HR pay error:', err);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

export default router;
