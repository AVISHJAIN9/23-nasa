import { ZodError } from 'zod';
import { AppError, RateLimitedError } from '../core/errors.js';
import { getRequestId } from '../core/requestContext.js';
import { logger } from '../core/logger.js';
/**
 * Centralized Express error-handling middleware.
 * Formats every non-2xx response into the unified AstroCare error contract.
 */
export const errorHandler = (err, _req, res, _next) => {
    const requestId = getRequestId();
    // Ensure X-Request-ID response header is populated
    if (!res.getHeader('X-Request-ID') && requestId !== 'system') {
        res.setHeader('X-Request-ID', requestId);
    }
    // Set Retry-After header if RateLimitedError specifies retryAfterSeconds
    if (err instanceof RateLimitedError && err.retryAfterSeconds && !res.getHeader('Retry-After')) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
    }
    // 1. Domain AppError
    if (err instanceof AppError) {
        const errorBody = {
            error: {
                code: err.code,
                message: err.message,
                request_id: requestId,
                ...(err.details !== undefined ? { details: err.details } : {}),
            },
        };
        res.status(err.statusCode).json(errorBody);
        return;
    }
    // 2. Zod validation error
    if (err instanceof ZodError) {
        const details = err.issues.map((issue) => ({
            field: issue.path.join('.') || 'request',
            issue: issue.message,
        }));
        const errorBody = {
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Request validation failed',
                request_id: requestId,
                details,
            },
        };
        res.status(422).json(errorBody);
        return;
    }
    // 3. Body-parser malformed JSON or payload too large
    const parseErr = err;
    if (parseErr.type === 'entity.parse.failed' ||
        (err instanceof SyntaxError && 'body' in parseErr)) {
        const errorBody = {
            error: {
                code: 'BAD_REQUEST',
                message: 'Malformed JSON payload in request body',
                request_id: requestId,
            },
        };
        res.status(400).json(errorBody);
        return;
    }
    if (parseErr.type === 'entity.too.large' || parseErr.status === 413) {
        const errorBody = {
            error: {
                code: 'BAD_REQUEST',
                message: 'Request payload exceeded maximum size limit (1mb)',
                request_id: requestId,
            },
        };
        res.status(400).json(errorBody);
        return;
    }
    // 4. Catch-all unexpected errors: mask internal details and log server-side
    logger.error({
        err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
        request_id: requestId,
    }, 'Unhandled server exception');
    const errorBody = {
        error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred. Please contact mission support with the request ID.',
            request_id: requestId,
        },
    };
    res.status(500).json(errorBody);
};
