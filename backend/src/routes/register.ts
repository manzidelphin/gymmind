import { Router, Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { env } from '../config/env';
import { normalizePhone } from '../utils/phone';
import {
  generateOTP,
  saveRegistrationOTP,
  sendOTP,
  verifyRegistrationOTP,
} from '../services/otp.service';

const router = Router();

// ---------------------------------------------------------------
// POST /api/register/send-otp
// Validates gym info + owner phone, sends OTP. No gym created yet.
// ---------------------------------------------------------------
const sendOtpSchema = z.object({
  gymName:   z.string().min(2).max(255),
  slug:      z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers and hyphens'),
  address:   z.string().max(500).optional(),
  ownerName: z.string().min(2).max(255),
  phone:     z.string().min(9),
});

router.post('/send-otp', async (req: Request, res: Response) => {
  const parsed = sendOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { slug } = parsed.data;
  const phone = normalizePhone(parsed.data.phone);

  // Check slug not already taken
  const [slugRows] = await pool.query<any[]>(
    'SELECT id FROM gyms WHERE slug = ?', [slug]
  );
  if (slugRows[0]) {
    res.status(409).json({ error: 'This gym URL is already taken. Choose a different one.' });
    return;
  }

  // Check phone not already registered anywhere
  const [phoneRows] = await pool.query<any[]>(
    'SELECT id FROM users WHERE phone = ?', [phone]
  );
  if (phoneRows[0]) {
    res.status(409).json({ error: 'This phone number is already registered.' });
    return;
  }

  const code = generateOTP();
  await saveRegistrationOTP(phone, code);
  await sendOTP(phone, code);

  res.json({
    message: 'OTP sent',
    ...(env.NODE_ENV !== 'production' ? { devCode: code } : {}),
  });
});

// ---------------------------------------------------------------
// POST /api/register
// Verify OTP → create gym + owner → return JWT.
// ---------------------------------------------------------------
const registerSchema = z.object({
  gymName:   z.string().min(2).max(255),
  slug:      z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
  address:   z.string().max(500).optional(),
  ownerName: z.string().min(2).max(255),
  phone:     z.string().min(9),
  code:      z.string().length(6),
});

router.post('/', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const phone = normalizePhone(parsed.data.phone);

  // Verify OTP
  const valid = await verifyRegistrationOTP(phone, parsed.data.code);
  if (!valid) {
    res.status(401).json({ error: 'Invalid or expired code.' });
    return;
  }

  // Re-check uniqueness (race condition guard)
  const [slugRows] = await pool.query<any[]>(
    'SELECT id FROM gyms WHERE slug = ?', [parsed.data.slug]
  );
  if (slugRows[0]) {
    res.status(409).json({ error: 'This gym URL was just taken. Please choose another.' });
    return;
  }

  // Create gym with 30-day trial
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 30);
  const trialEndStr = trialEnd.toISOString().slice(0, 10);

  const [gymResult] = await pool.query<any>(
    `INSERT INTO gyms (name, slug, address, subscription_plan, subscription_status, registration_status, trial_ends_at)
     VALUES (?, ?, ?, 'trial', 'active', 'approved', ?)`,
    [parsed.data.gymName, parsed.data.slug, parsed.data.address ?? null, trialEndStr]
  );
  const gymId: number = gymResult.insertId;

  // Create gym owner
  const [ownerResult] = await pool.query<any>(
    `INSERT INTO users (gym_id, name, phone, role, status)
     VALUES (?, ?, ?, 'gym_owner', 'active')`,
    [gymId, parsed.data.ownerName, phone]
  );

  const [ownerRows] = await pool.query<any[]>(
    'SELECT * FROM users WHERE id = ?', [ownerResult.insertId]
  );
  const owner = ownerRows[0];

  const token = jwt.sign(
    { userId: owner.id, gymId, role: owner.role },
    env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.status(201).json({
    token,
    gymSlug: parsed.data.slug,
    user: {
      id: owner.id, gym_id: gymId, name: owner.name,
      phone: owner.phone, role: owner.role, status: owner.status,
      institution_id: null, parent_id: null,
    },
  });
});

export default router;
