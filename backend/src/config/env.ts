import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),

  // Database
  DB_HOST:     z.string().default('localhost'),
  DB_PORT:     z.coerce.number().default(3306),
  DB_USER:     z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME:     z.string().default('gymmind'),

  // Auth
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),

  // OTP / Africa's Talking
  NODE_ENV:    z.enum(['development', 'production', 'test']).default('development'),
  AT_USERNAME: z.string().default('sandbox'),
  AT_API_KEY:  z.string().default(''),

  // Email / Gmail SMTP
  GMAIL_USER:         z.string().default(''),
  GMAIL_APP_PASSWORD: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
