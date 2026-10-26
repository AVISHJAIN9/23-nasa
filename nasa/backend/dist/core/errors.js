export const ERROR_STATUS_MAP = {
    BAD_REQUEST: 400,
    UNAUTHENTICATED: 401,
    TOKEN_EXPIRED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    VALIDATION_ERROR: 422,
    RATE_LIMITED: 429,
    INTERNAL_ERROR: 500,
    SERVICE_UNAVAILABLE: 503,
};
/**
 * Base application error. All domain and HTTP errors must extend this class.
 */
export class AppError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = ERROR_STATUS_MAP[code] ?? 500;
        this.details = details;
        Object.setPrototypeOf(this, new.target.prototype);
        Error.captureStackTrace(this, this.constructor);
    }
}
export class BadRequestError extends AppError {
    constructor(message = 'Bad request', details) {
        super('BAD_REQUEST', message, details);
    }
}
export class UnauthenticatedError extends AppError {
    constructor(message = 'Authentication required', details) {
        super('UNAUTHENTICATED', message, details);
    }
}
export class TokenExpiredError extends AppError {
    constructor(message = 'Token expired', details) {
        super('TOKEN_EXPIRED', message, details);
    }
}
export class ForbiddenError extends AppError {
    constructor(message = 'Access forbidden', details) {
        super('FORBIDDEN', message, details);
    }
}
export class NotFoundError extends AppError {
    constructor(message = 'Resource not found', details) {
        super('NOT_FOUND', message, details);
    }
}
export class ConflictError extends AppError {
    constructor(message = 'Resource conflict', details) {
        super('CONFLICT', message, details);
    }
}
export class ValidationError extends AppError {
    constructor(message = 'Validation error', details) {
        super('VALIDATION_ERROR', message, details);
    }
}
export class RateLimitedError extends AppError {
    retryAfterSeconds;
    constructor(message = 'Rate limit exceeded', retryAfterSeconds, details) {
        super('RATE_LIMITED', message, details);
        this.retryAfterSeconds = retryAfterSeconds;
    }
}
export class InternalError extends AppError {
    constructor(message = 'Internal server error', details) {
        super('INTERNAL_ERROR', message, details);
    }
}
export class ServiceUnavailableError extends AppError {
    constructor(message = 'Service unavailable', details) {
        super('SERVICE_UNAVAILABLE', message, details);
    }
}
