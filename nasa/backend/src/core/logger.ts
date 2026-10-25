import pino, { type Logger, type LoggerOptions } from 'pino';
import { getRequestId } from './requestContext.js';

export interface CreateLoggerOptions {
  level?: string;
}

/**
 * Creates a Pino logger instance configured to automatically attach the active request_id.
 */
export function createLogger(options?: CreateLoggerOptions): Logger {
  const pinoOptions: LoggerOptions = {
    level: options?.level || process.env['ASTRO_LOG_LEVEL'] || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'headers.cookie',
        'authorization',
        'cookie',
        'password',
        'password_hash',
        'token',
        'access_token',
        'refresh_token',
        'req.headers["x-ingest-key"]',
        'headers["x-ingest-key"]',
        'x-ingest-key',
        'ingest_key',
        'req.headers["x-ml-key"]',
        'headers["x-ml-key"]',
        'x-ml-key',
        'ml_key',
        'api_key',
      ],
      censor: '[REDACTED]',
    },
    mixin() {
      return { request_id: getRequestId() };
    },
  };

  return pino(pinoOptions);
}

export const logger = createLogger();
