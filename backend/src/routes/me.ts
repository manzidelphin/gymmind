/**
 * GET /api/me
 * Any authenticated gym user can fetch their own profile,
 * active membership, and last 10 check-ins.
 * Requires: auth + gym middleware (no role restriction).
 */
import { Router, Request, Response } from 'express';
import { pool } from '../config/db';
import { authenticate } from '../middleware/auth.middleware';
import { resolveGym } from '../middleware/gym.middleware';

const router = Router();

router.use(resolveGym, authenticate);

router.get('/', async (req: Request, res: Response) => {
  const gymId = req.gym.id;
  const userId = req.user.id;

  const [membershipRows] = await pool.query<any[]>(
    `SELECT um.*, mp.name AS plan_name, mp.type
     FROM user_memberships um
     JOIN membership_plans mp ON mp.id = um.plan_id AND mp.gym_id = ?
     WHERE um.user_id = ? AND um.gym_id = ? AND um.status = 'active'
     LIMIT 1`,
    [gymId, userId, gymId]
  );

  const [checkinRows] = await pool.query<any[]>(
    `SELECT checked_in_at, checkin_type
     FROM checkins
     WHERE user_id = ? AND gym_id = ?
     ORDER BY checked_in_at DESC
     LIMIT 10`,
    [userId, gymId]
  );

  res.json({
    user: req.user,
    membership: membershipRows[0] ?? null,
    recentCheckins: checkinRows,
  });
});

export default router;
