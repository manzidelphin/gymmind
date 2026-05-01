/**
 * AUTH ROUTES
 * All routes require the X-Gym-Slug header (resolveGym middleware).
 * No JWT required — this is how users get their tokens.
 *
 * ---------------------------------------------------------------
 * CURL TEST COMMANDS (dev mode)
 * ---------------------------------------------------------------
 *
 * 1. Send OTP (returns devCode in development):
 *    curl -X POST http://localhost:3001/api/auth/send-otp \
 *      -H "Content-Type: application/json" \
 *      -H "X-Gym-Slug: kigali-fitness" \
 *      -d '{"phone": "0788100003"}'
 *
 * 2. Verify OTP → get JWT token:
 *    curl -X POST http://localhost:3001/api/auth/verify-otp \
 *      -H "Content-Type: application/json" \
 *      -H "X-Gym-Slug: kigali-fitness" \
 *      -d '{"phone": "0788100003", "code": "<devCode from step 1>"}'
 *
 * 3. Claim account (new user — phone not yet registered at this gym):
 *    curl -X POST http://localhost:3001/api/auth/claim-account \
 *      -H "Content-Type: application/json" \
 *      -H "X-Gym-Slug: kigali-fitness" \
 *      -d '{"phone": "0788999999", "name": "Test User"}'
 *    NOTE: must have verified an OTP for this phone first.
 *
 * 4. Prove gym isolation — same phone, different gym = separate user:
 *    curl -X POST http://localhost:3001/api/auth/send-otp \
 *      -H "Content-Type: application/json" \
 *      -H "X-Gym-Slug: butare-gym" \
 *      -d '{"phone": "0788100003"}'
 * ---------------------------------------------------------------
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { resolveGym } from '../middleware/gym.middleware';
import { generateOTP, saveOTP, sendOTP, verifyOTP } from '../services/otp.service';
import { signToken } from '../services/jwt.service';
import { normalizePhone, validatePhone } from '../utils/phone';
import { pool } from '../config/db';
import { env } from '../config/env';

const router = Router();

// ---------------------------------------------------------------
// POST /api/auth/find-gym-by-phone
// Fully public — no gym slug or JWT required.
// Finds which gym a staff member belongs to by phone.
// Body: { phone }
// ---------------------------------------------------------------
const findGymSchema = z.object({ phone: z.string().min(9) });

router.post('/find-gym-by-phone', async (req: Request, res: Response) => {
  const parsed = findGymSchema.safeParse(req.body);
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
    `SELECT u.id, u.role, u.name,
            g.slug AS gym_slug, g.name AS gym_name
     FROM users u
     JOIN gyms g ON u.gym_id = g.id
     WHERE u.phone = ?
       AND u.role IN ('gym_owner', 'gym_manager')
       AND u.status = 'active'
       AND g.subscription_status IN ('active', 'trial')
     LIMIT 1`,
    [phone]
  );

  if (!rows[0]) {
    res.status(404).json({ error: 'No gym account found for this number' });
    return;
  }

  res.json({ gymSlug: rows[0].gym_slug, gymName: rows[0].gym_name });
});

// ---------------------------------------------------------------
// POST /api/auth/login/send-otp
// Fully public. Finds the staff member's gym, saves a gym-scoped OTP.
// Body: { phone }
// ---------------------------------------------------------------
const loginSendOtpSchema = z.object({ phone: z.string().min(9) });

router.post('/login/send-otp', async (req: Request, res: Response) => {
  const parsed = loginSendOtpSchema.safeParse(req.body);
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
    `SELECT u.id, u.gym_id, g.slug AS gym_slug, g.name AS gym_name
     FROM users u
     JOIN gyms g ON u.gym_id = g.id
     WHERE u.phone = ?
       AND u.role IN ('gym_owner', 'gym_manager')
       AND u.status = 'active'
       AND g.subscription_status IN ('active', 'trial')
     LIMIT 1`,
    [phone]
  );

  if (!rows[0]) {
    res.status(404).json({ error: 'No gym account found for this number' });
    return;
  }

  const code = generateOTP();
  await saveOTP(rows[0].gym_id, phone, code);
  await sendOTP(phone, code);

  const response: Record<string, unknown> = {
    gymSlug: rows[0].gym_slug,
    gymName: rows[0].gym_name,
  };
  if (env.NODE_ENV !== 'production') response.devCode = code;

  res.json(response);
});

// ---------------------------------------------------------------
// POST /api/auth/login/verify-otp
// Fully public. Verifies OTP scoped to the staff member's gym,
// signs JWT, returns { user, token, gymSlug, gymName }.
// Body: { phone, code }
// ---------------------------------------------------------------
const loginVerifyOtpSchema = z.object({
  phone: z.string().min(9),
  code:  z.string().length(6),
});

router.post('/login/verify-otp', async (req: Request, res: Response) => {
  const parsed = loginVerifyOtpSchema.safeParse(req.body);
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

  const [userRows] = await pool.query<any[]>(
    `SELECT u.*, g.slug AS gym_slug, g.name AS gym_name
     FROM users u
     JOIN gyms g ON u.gym_id = g.id
     WHERE u.phone = ?
       AND u.role IN ('gym_owner', 'gym_manager')
       AND u.status = 'active'
       AND g.subscription_status IN ('active', 'trial')
     LIMIT 1`,
    [phone]
  );

  if (!userRows[0]) {
    res.status(404).json({ error: 'No gym account found for this number' });
    return;
  }

  const valid = await verifyOTP(userRows[0].gym_id, phone, parsed.data.code);
  if (!valid) {
    res.status(400).json({ error: 'Invalid or expired code' });
    return;
  }

  const user = userRows[0];
  const token = signToken({
    userId: user.id,
    gymId:  user.gym_id,
    role:   user.role,
    phone:  user.phone,
  });

  res.json({ user, token, gymSlug: user.gym_slug, gymName: user.gym_name });
});

// ---------------------------------------------------------------
// POST /api/auth/admin/send-otp
// Super-admin only — no gym slug required.
// Saves OTP with gym_id = NULL so it is not scoped to any gym.
// Body: { phone }
// ---------------------------------------------------------------
const adminSendOtpSchema = z.object({ phone: z.string().min(9) });

router.post('/admin/send-otp', async (req: Request, res: Response) => {
  const parsed = adminSendOtpSchema.safeParse(req.body);
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

  // Confirm this phone belongs to a super_admin before sending
  const [rows] = await pool.query<any[]>(
    `SELECT id FROM users WHERE phone = ? AND role = 'super_admin' LIMIT 1`,
    [phone]
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'No super admin account found for this number' });
    return;
  }

  const code = generateOTP();
  await saveOTP(null, phone, code);
  await sendOTP(phone, code);

  const response: Record<string, unknown> = {};
  if (env.NODE_ENV !== 'production') response.devCode = code;

  res.json(response);
});

// ---------------------------------------------------------------
// POST /api/auth/admin/verify-otp
// Super-admin only — no gym slug required.
// Verifies OTP scoped to gym_id IS NULL, returns JWT.
// Body: { phone, code }
// ---------------------------------------------------------------
const adminVerifyOtpSchema = z.object({
  phone: z.string().min(9),
  code:  z.string().length(6),
});

let _verifyCallCount = 0;
router.post('/admin/verify-otp', async (req: Request, res: Response) => {
  const callId = ++_verifyCallCount;
  console.log(`[Admin Verify #${callId}] ── NEW REQUEST ──`);
  console.log(`[Admin Verify #${callId}] Body:`, req.body);

  const parsed = adminVerifyOtpSchema.safeParse(req.body);
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

  console.log(`[Admin Verify #${callId}] Normalized phone: ${phone}, code: ${parsed.data.code}`);

  const valid = await verifyOTP(null, phone, parsed.data.code);
  console.log(`[Admin Verify #${callId}] verifyOTP result: ${valid}`);
  if (!valid) {
    console.log(`[Admin Verify #${callId}] → returning 401`);
    res.status(401).json({ error: 'Invalid or expired OTP' });
    return;
  }

  const [userRows] = await pool.query<any[]>(
    `SELECT * FROM users WHERE phone = ? AND role = 'super_admin' LIMIT 1`,
    [phone]
  );
  console.log(`[Admin Verify #${callId}] Super admin found: ${!!userRows[0]}`);
  if (!userRows[0]) {
    res.status(403).json({ error: 'Super admin access only.' });
    return;
  }

  const user = userRows[0];
  console.log(`[Admin Verify #${callId}] Signing JWT...`);
  const token = signToken({
    userId: user.id,
    gymId:  null,
    role:   user.role,
    phone:  user.phone,
  });
  console.log(`[Admin Verify #${callId}] JWT signed, sending 200`);
  res.json({ user, token });
});

// All other auth routes need to know which gym they're operating in
router.use(resolveGym);

// ---------------------------------------------------------------
// POST /api/auth/send-otp
// ---------------------------------------------------------------
const sendOtpSchema = z.object({
  phone: z.string().min(9),
});

router.post('/send-otp', async (req: Request, res: Response) => {
  const parsed = sendOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  let phone: string;
  try {
    phone = normalizePhone(parsed.data.phone);
    if (!validatePhone(phone)) throw new Error('Invalid phone number format');
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }
  const gymId = req.gym.id;

  const code = generateOTP();
  await saveOTP(gymId, phone, code);
  await sendOTP(phone, code);

  const response: Record<string, unknown> = {
    message: 'OTP sent',
    expiresIn: 300,
  };

  // In development, return the code so testing doesn't require SMS
  if (env.NODE_ENV !== 'production') {
    response.devCode = code;
  }

  res.json(response);
});

// ---------------------------------------------------------------
// POST /api/auth/verify-otp
// ---------------------------------------------------------------
const verifyOtpSchema = z.object({
  phone: z.string().min(9),
  code: z.string().length(6),
});

router.post('/verify-otp', async (req: Request, res: Response) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  let phone: string;
  try {
    phone = normalizePhone(parsed.data.phone);
    if (!validatePhone(phone)) throw new Error('Invalid phone number format');
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }
  const gymId = req.gym.id;

  const valid = await verifyOTP(gymId, phone, parsed.data.code);
  if (!valid) {
    res.status(401).json({ error: 'Invalid or expired OTP' });
    return;
  }

  // Look up user: gym-scoped first, then fall back to super_admin (gym_id IS NULL).
  // super_admin has no gym_id — they span all gyms and can log in via any gym's OTP endpoint.
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM users
     WHERE phone = ? AND (gym_id = ? OR (gym_id IS NULL AND role = 'super_admin'))
     ORDER BY (gym_id IS NULL) ASC   -- 0 (not null, gym user) sorts before 1 (null, super_admin)
     LIMIT 1`,
    [phone, gymId]
  );

  if (!rows[0]) {
    // Phone verified but no account at this gym yet → prompt registration
    res.json({ newUser: true, phone });
    return;
  }

  const user = rows[0];

  // When a super_admin logs in via a gym's OTP endpoint, scope their token
  // to that gym so gym-scoped API calls work. If they have a gym-scoped account
  // at this gym the query already returned that user instead (ORDER BY gym_id IS NULL ASC).
  const tokenGymId = (user.role === 'super_admin' && user.gym_id === null)
    ? req.gym.id
    : user.gym_id;

  const token = signToken({
    userId: user.id,
    gymId:  tokenGymId,
    role:   user.role,
    phone:  user.phone,
  });

  res.json({ user, token });
});

// ---------------------------------------------------------------
// GET /api/auth/claim-search?name=xxx
// Public — returns unclaimed members at this gym matching the name.
// Only exposes id+name (no phone since it's NULL anyway).
// ---------------------------------------------------------------
router.get('/claim-search', async (req: Request, res: Response) => {
  const name = ((req.query.name as string) || '').trim();
  if (name.length < 2) {
    res.json([]);
    return;
  }

  const gymId = req.gym.id;
  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.name,
            p.name AS parent_name,
            i.name AS institution_name
     FROM users u
     LEFT JOIN users i_parent ON i_parent.id = u.parent_id AND i_parent.gym_id = u.gym_id
     LEFT JOIN users p ON p.id = u.parent_id AND p.gym_id = u.gym_id
     LEFT JOIN institutions i ON i.id = COALESCE(u.institution_id, i_parent.institution_id) AND i.gym_id = u.gym_id
     WHERE u.gym_id = ? AND u.status = 'unclaimed' AND u.name LIKE ?
     ORDER BY u.name LIMIT 15`,
    [gymId, `%${name}%`]
  );

  res.json(rows);
});

// ---------------------------------------------------------------
// POST /api/auth/claim-account
// Member selects their unclaimed record, verifies phone via OTP,
// and activates the account in one step.
// Body: { userId, phone, code }
// ---------------------------------------------------------------
const claimSchema = z.object({
  userId: z.number().int().positive(),
  phone:  z.string().min(9),
  code:   z.string().length(6),
});

router.post('/claim-account', async (req: Request, res: Response) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  let phone: string;
  try {
    phone = normalizePhone(parsed.data.phone);
    if (!validatePhone(phone)) throw new Error('Invalid phone number format');
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }
  const gymId = req.gym.id;

  // Verify OTP
  const valid = await verifyOTP(gymId, phone, parsed.data.code);
  if (!valid) {
    res.status(401).json({ error: 'Invalid or expired OTP' });
    return;
  }

  // Find the unclaimed user at this gym
  const [userRows] = await pool.query<any[]>(
    `SELECT * FROM users WHERE id = ? AND gym_id = ? AND status = 'unclaimed'`,
    [parsed.data.userId, gymId]
  );

  if (!userRows[0]) {
    res.status(404).json({ error: 'Unclaimed account not found at this gym.' });
    return;
  }

  // Ensure no other user already has this phone at this gym
  const [dupRows] = await pool.query<any[]>(
    'SELECT id FROM users WHERE gym_id = ? AND phone = ?',
    [gymId, phone]
  );
  if (dupRows[0]) {
    res.status(409).json({ error: 'This phone number is already linked to another account.' });
    return;
  }

  // Claim: attach phone, activate
  await pool.query(
    `UPDATE users SET phone = ?, status = 'active' WHERE id = ? AND gym_id = ?`,
    [phone, parsed.data.userId, gymId]
  );

  const [updatedRows] = await pool.query<any[]>(
    'SELECT * FROM users WHERE id = ?',
    [parsed.data.userId]
  );

  const user = updatedRows[0];
  const token = signToken({
    userId: user.id,
    gymId:  user.gym_id,
    role:   user.role,
    phone:  user.phone,
  });

  // Generate checkin token for immediate checkin after claiming
  const checkinOtp = Math.floor(100000 + Math.random() * 900000).toString();
  await pool.query(
    `INSERT INTO otps (gym_id, phone, code, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
    [gymId, phone, checkinOtp]
  );
  res.json({ user, token, checkinToken: checkinOtp });
});

export default router;
