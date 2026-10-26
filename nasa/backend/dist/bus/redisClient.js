import { Redis } from 'ioredis';
import { logger } from '../core/logger.js';
/**
 * Strips password / credentials from a Redis connection URL for safe logging.
 */
export function sanitizeRedisUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.password) {
            parsed.password = '***';
        }
        if (parsed.username) {
            parsed.username = '***';
        }
        return parsed.toString();
    }
    catch {
        return 'redis://[redacted]';
    }
}
/**
 * Creates an ioredis client with exponential backoff and jitter.
 * Logs connection state changes without leaking credentials.
 */
export function createRedisClient(url, options) {
    const clientName = options?.name ?? 'default';
    const sanitizedUrl = sanitizeRedisUrl(url);
    const redisOptions = {
        enableOfflineQueue: options?.enableOfflineQueue ?? true,
        maxRetriesPerRequest: options?.enableOfflineQueue === false ? 0 : 3,
        retryStrategy(times) {
            // Exponential backoff: start at 100ms, double up to 5000ms, plus random jitter
            const delay = Math.min(100 * Math.pow(2, times - 1), 5000);
            const jitter = Math.floor(Math.random() * 100);
            const totalDelay = delay + jitter;
            logger.debug({ clientName, times, totalDelay, url: sanitizedUrl }, 'Redis reconnecting with backoff');
            return totalDelay;
        },
        lazyConnect: false,
    };
    const client = new Redis(url, redisOptions);
    client.on('connect', () => {
        logger.debug({ clientName, url: sanitizedUrl }, 'Redis client connected');
    });
    client.on('ready', () => {
        logger.info({ clientName, url: sanitizedUrl }, 'Redis client ready');
    });
    client.on('error', (err) => {
        logger.warn({ clientName, err: err.message, url: sanitizedUrl }, 'Redis client error');
    });
    client.on('close', () => {
        logger.debug({ clientName, url: sanitizedUrl }, 'Redis client closed');
    });
    client.on('reconnecting', () => {
        logger.debug({ clientName, url: sanitizedUrl }, 'Redis client reconnecting');
    });
    return client;
}
