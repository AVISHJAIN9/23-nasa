import { NotFoundError } from '../core/errors.js';
/**
 * 404 Not Found middleware for unmatched routes.
 * Passes a structured NotFoundError to the centralized error handler.
 */
export function notFoundHandler(req, _res, next) {
    next(new NotFoundError(`Route '${req.method} ${req.originalUrl}' not found`));
}
