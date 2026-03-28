import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/jwt.service';
import { pool } from '../config/db';

/**
 * Verifies the Bearer JWT, then fetches the user from DB to ensure
 * they still exist and haven't been suspended.
 * Attaches the DB user record to req.user.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Always verify against DB — token alone is not enough
  const [rows] = await pool.query<any[]>(
    'SELECT * FROM users WHERE id = ?',
    [payload.userId]
  );

  if (!rows[0]) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  const user = rows[0];

  // If req.gym is set (gym-scoped route), verify the token belongs to this gym.
  // super_admin has gym_id = null and is allowed to operate across all gyms.
  if (req.gym && user.gym_id !== null && user.gym_id !== req.gym.id) {
    res.status(403).json({ error: 'Token does not belong to this gym' });
    return;
  }

  req.user = user;
  next();
}
