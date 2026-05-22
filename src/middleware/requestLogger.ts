import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/** Log API calls that should trigger invitation emails (debug local dev). */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const path = req.originalUrl || req.url;

  res.on('finish', () => {
    const ms = Date.now() - start;
    const shouldLog =
      req.method === 'POST' ||
      req.method === 'PUT' ||
      path.includes('/auth') ||
      path.includes('/users') ||
      path.includes('/organizations') ||
      path.includes('/resend-invitation');

    if (!shouldLog) {
      return;
    }

    logger.info('HTTP', {
      method: req.method,
      path,
      status: res.statusCode,
      ms,
    });
  });

  next();
}
