import { Request, Response, NextFunction } from 'express';
import type { User } from '../types';

type Role = User['role'];

/**
 * Factory that returns a middleware enforcing one of the allowed roles.
 * Must be used AFTER authenticate middleware (requires req.user).
 *
 * Usage:
 *   router.post('/plans', requireRole('gym_owner', 'gym_manager'), handler)
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // super_admin can access any gym-scoped route
    if (req.user.role === 'super_admin') {
      next();
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
