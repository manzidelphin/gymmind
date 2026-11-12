import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),

  // Database (Supabase Postgres connection string)
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Optional PEM CA certificate used to verify the database server
  DATABASE_CA_CERT: z.string().default(''),

  // Auth
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),

  // OTP / Africa's Talking
  NODE_ENV:    z.enum(['development', 'production', 'test']).default('development'),
  AT_USERNAME: z.string().default('sandbox'),
  AT_API_KEY:  z.string().default(''),

  // Email / Gmail SMTP
  GMAIL_USER:         z.string().default(''),
  GMAIL_APP_PASSWORD: z.string().default(''),

  // Gemini key for the HR assistant, and the secret Vercel Cron sends
  GEMINI_API_KEY: z.string().default(''),
  CRON_SECRET:    z.string().default(''),

  // Frontend URL (used in SMS links)
  FRONTEND_URL: z.string().default('gymmind.rw'),

  // MTN MoMo Collections
  MTN_MOMO_SUBSCRIPTION_KEY: z.string().default(''),
  MTN_MOMO_PRIMARY_KEY:      z.string().default(''),
  MTN_MOMO_SECONDARY_KEY:    z.string().default(''),
  MTN_MOMO_API_USER_ID:      z.string().default(''),
  MTN_MOMO_API_KEY:          z.string().default(''),
  MTN_MOMO_BASE_URL:         z.string().default('https://sandbox.momodeveloper.mtn.com'),
  MTN_MOMO_ENV:              z.string().default('sandbox'),
  MTN_MOMO_ENVIRONMENT:      z.string().default('sandbox'),
  MTN_MOMO_CURRENCY:         z.string().default('RWF'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
