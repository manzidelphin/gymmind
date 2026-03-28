/**
 * INSTITUTION AUTH ROUTES
 * Fully public — no gym middleware, no JWT required.
 * Institution admins use their phone number to log in.
 *
 * POST /api/institution/send-otp   — find institution admin, send OTP
 * POST /api/institution/verify-otp — verify OTP, return JWT
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { env } from '../config/env';
import { generateOTP, saveOTP, sendOTP, verifyOTP } from '../services/otp.service';
import { signToken } from '../services/jwt.service';
import { normalizePhone, validatePhone } from '../utils/phone';

const router = Router();

const ADMIN_QUERY = `
  SELECT u.id, u.gym_id, u.name, u.phone, u.status,
         i.id   AS institution_id,
         i.name AS institution_name,
         i.slug AS institution_slug,
         g.name AS gym_name
  FROM users u
  JOIN institutions i ON u.institution_id = i.id
  JOIN gyms g ON u.gym_id = g.id
  WHERE u.phone = ?
    AND u.role = 'institution_admin'
    AND u.status = 'active'
  LIMIT 1
`;

// ---------------------------------------------------------------
// POST /api/institution/send-otp
// ---------------------------------------------------------------
const sendOtpSchema = z.object({ phone: z.string().min(9) });

router.post('/send-otp', async (req: Request, res: Response) => {
  const parsed = sendOtpSchema.safeParse(req.body);
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

  const [rows] = await pool.query<any[]>(ADMIN_QUERY, [phone]);

  if (!rows[0]) {
    res.status(404).json({ error: 'No institution account found for this number' });
    return;
  }

  const admin = rows[0];
  const code = generateOTP();
  await saveOTP(admin.gym_id, phone, code);
  await sendOTP(phone, code);

  const response: Record<string, unknown> = {
    institutionSlug: admin.institution_slug,
    institutionName: admin.institution_name,
    gymName:         admin.gym_name,
  };
  if (env.NODE_ENV !== 'production') response.devCode = code;

  res.json(response);
});

// ---------------------------------------------------------------
// POST /api/institution/verify-otp
// ---------------------------------------------------------------
const verifyOtpSchema = z.object({
  phone: z.string().min(9),
  code:  z.string().length(6),
});

router.post('/verify-otp', async (req: Request, res: Response) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
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

  const [rows] = await pool.query<any[]>(ADMIN_QUERY, [phone]);

  if (!rows[0]) {
    res.status(404).json({ error: 'No institution account found for this number' });
    return;
  }

  const admin = rows[0];
  const valid = await verifyOTP(admin.gym_id, phone, parsed.data.code);
  if (!valid) {
    res.status(400).json({ error: 'Invalid or expired code' });
    return;
  }

  const token = signToken({
    userId:        admin.id,
    gymId:         admin.gym_id,
    role:          'institution_admin',
    phone:         admin.phone,
    institutionId: admin.institution_id,
  });

  res.json({
    user: {
      id:             admin.id,
      name:           admin.name,
      phone:          admin.phone,
      role:           'institution_admin',
      gym_id:         admin.gym_id,
      institution_id: admin.institution_id,
    },
    token,
    institutionSlug: admin.institution_slug,
    institutionName: admin.institution_name,
    gymName:         admin.gym_name,
  });
});

export default router;
