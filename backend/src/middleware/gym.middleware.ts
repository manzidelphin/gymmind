import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/db';

/**
 * Reads the X-Gym-Slug header, resolves the gym from DB,
 * checks subscription status, and attaches it to req.gym.
 *
 * All gym-scoped routes must use this middleware.
 * Super admin routes skip this — they use no gym header.
 */
export async function resolveGym(req: Request, res: Response, next: NextFunction): Promise<void> {
  const slug = req.headers['x-gym-slug'] as string | undefined;

  if (!slug) {
    res.status(400).json({ error: 'Missing X-Gym-Slug header' });
    return;
  }

  const [rows] = await pool.query<any[]>(
    'SELECT * FROM gyms WHERE slug = ?',
    [slug]
  );

  if (!rows[0]) {
    res.status(404).json({ error: 'Gym not found' });
    return;
  }

  if (rows[0].subscription_status === 'suspended') {
    res.status(403).json({ error: 'Gym subscription suspended' });
    return;
  }

  req.gym = rows[0];
  next();
}
