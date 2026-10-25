import { type ErrorCode, type ErrorDetail } from '../schemas/common.js';

export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
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
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: ErrorDetail[] | Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[] | Record<string, unknown>) {
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
  constructor(message = 'Bad request', details?: ErrorDetail[]) {
    super('BAD_REQUEST', message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required', details?: ErrorDetail[]) {
    super('UNAUTHENTICATED', message, details);
  }
}

export class TokenExpiredError extends AppError {
  constructor(message = 'Token expired', details?: ErrorDetail[]) {
    super('TOKEN_EXPIRED', message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden', details?: ErrorDetail[]) {
    super('FORBIDDEN', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: ErrorDetail[]) {
    super('NOT_FOUND', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details?: ErrorDetail[] | Record<string, unknown>) {
    super('CONFLICT', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation error', details?: ErrorDetail[]) {
    super('VALIDATION_ERROR', message, details);
  }
}

export class RateLimitedError extends AppError {
  public readonly retryAfterSeconds?: number;

  constructor(
    message = 'Rate limit exceeded',
    retryAfterSeconds?: number,
    details?: ErrorDetail[],
  ) {
    super('RATE_LIMITED', message, details);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error', details?: ErrorDetail[]) {
    super('INTERNAL_ERROR', message, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable', details?: ErrorDetail[]) {
    super('SERVICE_UNAVAILABLE', message, details);
  }
}
