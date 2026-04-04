import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { errorHandler } from './middleware/error.middleware';
import registerRoutes from './routes/register';
import authRoutes from './routes/auth';
import checkinRoutes from './routes/checkin';
import userRoutes from './routes/users';
import membershipRoutes from './routes/memberships';
import membershipRequestsRouter from './routes/membershipRequests';
import institutionRoutes from './routes/institutions';
import reportRoutes from './routes/reports';
import gymAdminRoutes from './routes/gyms';
import meRoutes from './routes/me';
import paymentsRouter from './routes/payments';
import gymSettingsRouter from './routes/gymSettings';
import signupRouter from './routes/signup';
import institutionAuthRouter from './routes/institutionAuth';
import institutionPortalRouter from './routes/institutionPortal';
import servicesRouter from './routes/services';
import billingRouter from './routes/institutionalBilling';
import hrRouter from './routes/hr';
import { authenticate } from './middleware/auth.middleware';
import { checkExpiringMemberships, sendAttendanceReminders, sendMonthlyGymSummaries } from './services/expiry.service';

const app = express();

// ---------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------
// Public routes — no auth, no gym middleware
// ---------------------------------------------------------------

// GET /api/public/check-slug?slug=xxx
// Used by signup page to check slug availability before the gym exists.
app.get('/api/public/check-slug', async (req, res) => {
  const slug = ((req.query.slug as string) || '').trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]{3,50}$/.test(slug)) {
    res.json({ available: false });
    return;
  }
  const { pool } = await import('./config/db');
  const [rows] = await pool.query<any[]>('SELECT id FROM gyms WHERE slug = ?', [slug]);
  res.json({ available: !rows[0] });
});

// ---------------------------------------------------------------
// Routes
// ---------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/register', registerRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/users', userRoutes);
app.use('/api/membership-plans', membershipRoutes);
app.use('/api/membership-requests', membershipRequestsRouter);
app.use('/api/institutions', institutionRoutes);
app.use('/api/services', servicesRouter);
app.use('/api/reports', reportRoutes);
app.use('/api/billing', billingRouter);
app.use('/api/hr',      hrRouter);
app.use('/api/admin', gymAdminRoutes);
app.use('/api/me', meRoutes);
app.use('/api/payments', paymentsRouter);
app.use('/api/gyms',    gymSettingsRouter);
app.use('/api/signup',  signupRouter);
app.use('/api/institution', institutionAuthRouter);       // public: send-otp, verify-otp
app.use('/api/institution', authenticate, institutionPortalRouter);  // protected: me, members, attendance

// Health check — no auth, no gym header required
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------
// Global error handler (must be last)
// ---------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------
app.listen(env.PORT, () => {
  console.log(`GymMind backend running on http://localhost:${env.PORT}`);
});

// Run immediately on startup to catch any missed warnings
checkExpiringMemberships().catch(console.error);
sendAttendanceReminders().catch(console.error);
sendMonthlyGymSummaries().catch(console.error);

// Then run every 24 hours
setInterval(() => {
  checkExpiringMemberships().catch(console.error);
  sendAttendanceReminders().catch(console.error);
  sendMonthlyGymSummaries().catch(console.error);
}, 24 * 60 * 60 * 1000);

console.log('[Expiry] Daily membership expiry check scheduled');
console.log('[Reminder] Monthly attendance reminder scheduled');
console.log('[Monthly] Monthly gym summary email scheduled');

export default app;
