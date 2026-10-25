import type { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../core/errors.js';

/**
 * 404 Not Found middleware for unmatched routes.
 * Passes a structured NotFoundError to the centralized error handler.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route '${req.method} ${req.originalUrl}' not found`));
}
