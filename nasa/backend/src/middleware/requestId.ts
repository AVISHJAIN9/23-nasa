import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { runWithRequestContext } from '../core/requestContext.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether a string is a standard RFC 4122 UUID.
 */
function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Request ID middleware.
 * Inspects incoming 'X-Request-ID' header. If present and valid UUID, preserves it.
 * Otherwise generates a new UUID v4. Attaches to response header and AsyncLocalStorage.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && isValidUuid(incoming) ? incoming : randomUUID();

  res.setHeader('X-Request-ID', requestId);

  runWithRequestContext({ requestId }, () => {
    next();
  });
}
