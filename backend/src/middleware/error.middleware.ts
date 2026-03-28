import { Request, Response, NextFunction } from 'express';

/**
 * Global error handler. Must be registered LAST in Express (4 args).
 * Catches any error passed to next(err) or thrown in async routes.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  console.error('[Error]', err.message);

  // Zod validation errors come through as plain Errors with a message
  res.status(500).json({ error: err.message ?? 'Internal server error' });
}
