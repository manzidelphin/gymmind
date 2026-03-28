import { pool } from '../config/db';
import { env } from '../config/env';

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function saveOTP(gymId: number | null, phone: string, code: string): Promise<void> {
  await pool.query(
    `INSERT INTO otps (gym_id, phone, code, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
    [gymId, phone, code]
  );
}

export async function sendOTP(phone: string, code: string): Promise<void> {
  if (env.NODE_ENV !== 'production') {
    // Dev: log to console only — no SMS sent
    console.log(`[DEV OTP] ${phone}: ${code}`);
    return;
  }

  // PROD: send via Africa's Talking
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AfricasTalking = require('africastalking');
  const at = AfricasTalking({ username: env.AT_USERNAME, apiKey: env.AT_API_KEY });
  await at.SMS.send({
    to: [phone],
    message: `Your GymMind code: ${code}. Valid for 5 minutes. Do not share.`,
    from: 'GYMMIND',
  });
}

export async function saveRegistrationOTP(phone: string, code: string): Promise<void> {
  await pool.query(
    `INSERT INTO otps (gym_id, phone, code, expires_at)
     VALUES (NULL, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [phone, code]
  );
}

export async function verifyRegistrationOTP(phone: string, code: string): Promise<boolean> {
  const [rows] = await pool.query<any[]>(
    `SELECT id FROM otps
     WHERE gym_id IS NULL AND phone = ? AND code = ?
       AND used = false AND expires_at > NOW()
     LIMIT 1`,
    [phone, code]
  );
  if (!rows[0]) return false;
  await pool.query(`UPDATE otps SET used = true WHERE id = ?`, [rows[0].id]);
  return true;
}

export async function verifyOTP(gymId: number | null, phone: string, code: string): Promise<boolean> {
  const [rows] = await pool.query<any[]>(
    gymId !== null
      ? `SELECT id FROM otps WHERE gym_id = ? AND phone = ? AND code = ? AND used = false AND expires_at > NOW() LIMIT 1`
      : `SELECT id FROM otps WHERE gym_id IS NULL AND phone = ? AND code = ? AND used = false AND expires_at > NOW() LIMIT 1`,
    gymId !== null ? [gymId, phone, code] : [phone, code]
  );

  if (!rows[0]) return false;

  // Mark as used immediately — prevents replay attacks
  await pool.query(`UPDATE otps SET used = true WHERE id = ?`, [rows[0].id]);
  return true;
}

/**
 * Check OTP validity WITHOUT consuming it.
 * Used by /checkin/peek so the actual /checkin call can still consume the OTP.
 */
export async function peekOTP(gymId: number | null, phone: string, code: string): Promise<boolean> {
  const [rows] = await pool.query<any[]>(
    gymId !== null
      ? `SELECT id FROM otps WHERE gym_id = ? AND phone = ? AND code = ? AND used = false AND expires_at > NOW() LIMIT 1`
      : `SELECT id FROM otps WHERE gym_id IS NULL AND phone = ? AND code = ? AND used = false AND expires_at > NOW() LIMIT 1`,
    gymId !== null ? [gymId, phone, code] : [phone, code]
  );
  return !!rows[0];
}
