/**
 * SIGNUP ROUTES — fully public, no gym middleware required.
 * Used by new gym owners to self-register.
 *
 * GET  /api/signup/check-slug?slug=xxx   — check slug availability
 * POST /api/signup/send-otp              — send OTP (gym_id = NULL)
 * POST /api/signup/create-gym            — verify OTP + create gym + owner
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { env } from '../config/env';
import { normalizePhone, validatePhone } from '../utils/phone';
import {
  generateOTP,
  saveRegistrationOTP,
  verifyRegistrationOTP,
  sendOTP,
} from '../services/otp.service';
import { signToken } from '../services/jwt.service';
import { sendWelcomeEmail } from '../services/email.service';

const router = Router();

// ---------------------------------------------------------------
// GET /api/signup/check-slug?slug=xxx
// No auth. Returns { available: bool }.
// ---------------------------------------------------------------
router.get('/check-slug', async (req: Request, res: Response) => {
  const slug = ((req.query.slug as string) || '').trim().toLowerCase();

  if (!slug || !/^[a-z0-9-]{3,50}$/.test(slug)) {
    res.json({ available: false, reason: 'invalid' });
    return;
  }

  const [rows] = await pool.query<any[]>('SELECT id FROM gyms WHERE slug = ?', [slug]);
  res.json({ available: !rows[0] });
});

// ---------------------------------------------------------------
// POST /api/signup/send-otp
// Body: { phone }
// Saves OTP with gym_id = NULL (registration flow).
// ---------------------------------------------------------------
const sendOtpSchema = z.object({ phone: z.string().min(9) });

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

  const code = generateOTP();
  await saveRegistrationOTP(phone, code);
  await sendOTP(phone, code);

  const response: Record<string, unknown> = { message: 'OTP sent', expiresIn: 600 };
  if (env.NODE_ENV !== 'production') response.devCode = code;

  res.json(response);
});

// ---------------------------------------------------------------
// POST /api/signup/create-gym
// Body: { gymName, slug, ownerName, ownerPhone, momoNumber?, otp }
// Verifies OTP, creates gym + gym_owner user, returns JWT.
// ---------------------------------------------------------------
const createGymSchema = z.object({
  gymName:          z.string().min(2).max(100),
  slug:             z.string().min(3).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  city:             z.string().min(2).max(100),
  subscriptionPlan: z.enum(['trial', 'basic', 'pro', 'enterprise']),
  ownerName:        z.string().min(1).max(255),
  ownerPhone:       z.string().min(9),
  momoNumber:       z.string().min(9),
  email:            z.string().email(),
  otp:              z.string().length(6),
});

router.post('/create-gym', async (req: Request, res: Response) => {
  const parsed = createGymSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { gymName, slug, city, subscriptionPlan, ownerName, otp, email: gymEmail } = parsed.data;

  let ownerPhone: string;
  try {
    ownerPhone = normalizePhone(parsed.data.ownerPhone);
    if (!validatePhone(ownerPhone)) throw new Error('Invalid phone number format');
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  // Verify OTP (gym_id = NULL registration flow)
  const valid = await verifyRegistrationOTP(ownerPhone, otp);
  if (!valid) {
    res.status(401).json({ error: 'Invalid or expired OTP. Request a new code and try again.' });
    return;
  }

  // Check slug is still available
  const [slugRows] = await pool.query<any[]>('SELECT id FROM gyms WHERE slug = ?', [slug]);
  if (slugRows[0]) {
    res.status(409).json({ error: 'That gym slug is already taken. Please choose another.' });
    return;
  }

  // Normalize momo number
  let momoNumber: string;
  try {
    momoNumber = normalizePhone(parsed.data.momoNumber);
    if (!validatePhone(momoNumber)) throw new Error('Invalid MoMo number format');
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  // Create gym
  const [gymResult] = await pool.query<any>(
    `INSERT INTO gyms (name, slug, city, subscription_plan, phone, momo_number, email) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [gymName, slug, city, subscriptionPlan, ownerPhone, momoNumber, gymEmail]
  );
  const gymId: number = gymResult.insertId;

  // Create gym_owner user
  const [userResult] = await pool.query<any>(
    `INSERT INTO users (gym_id, name, phone, role, status) VALUES (?, ?, ?, 'gym_owner', 'active')`,
    [gymId, ownerName, ownerPhone]
  );
  const userId: number = userResult.insertId;

  const token = signToken({ userId, gymId, role: 'gym_owner', phone: ownerPhone });

  const [[gym]]  = await pool.query<any[]>('SELECT id, name, slug FROM gyms WHERE id = ?', [gymId]);
  const [[user]] = await pool.query<any[]>('SELECT id, name, phone, role FROM users WHERE id = ?', [userId]);

  // Send welcome email (non-blocking — never fail signup)
  if (gymEmail) {
    sendWelcomeEmail({ to: gymEmail, gymName, gymSlug: slug, ownerName })
      .catch(e => console.error('[EMAIL] Welcome email failed:', e));
  }

  res.status(201).json({ gym, user, token });
});

export default router;
