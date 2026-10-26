import { RateLimitedError } from './errors.js';
import { logger } from './logger.js';
/**
 * In-memory rate limiter with lazy TTL expiration.
 * Used for development, testing, and automatic failover when Redis is unreachable.
 */
export class MemoryRateLimiter {
    store = new Map();
    async consume(key, limit, windowSeconds) {
        const now = Date.now();
        const windowMs = windowSeconds * 1000;
        const entry = this.store.get(key);
        if (!entry || now >= entry.resetAt) {
            const resetAt = now + windowMs;
            this.store.set(key, { count: 1, resetAt });
            return {
                allowed: true,
                limit,
                remaining: Math.max(0, limit - 1),
                resetSeconds: windowSeconds,
                retryAfterSeconds: 0,
            };
        }
        entry.count += 1;
        const remainingSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
        if (entry.count <= limit) {
            return {
                allowed: true,
                limit,
                remaining: limit - entry.count,
                resetSeconds: remainingSeconds,
                retryAfterSeconds: 0,
            };
        }
        return {
            allowed: false,
            limit,
            remaining: 0,
            resetSeconds: remainingSeconds,
            retryAfterSeconds: remainingSeconds,
        };
    }
    async reset(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
}
const REDIS_RATE_LIMIT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, window)
end
local ttl = redis.call('TTL', key)
if ttl < 0 then
  ttl = window
  redis.call('EXPIRE', key, window)
end

return { current, ttl }
`;
/**
 * Distributed, Redis-backed rate limiter using an atomic Lua script.
 * Safely falls back to MemoryRateLimiter if Redis throws a connection exception.
 */
export class RedisRateLimiter {
    redis;
    keyPrefix;
    memoryFallback = new MemoryRateLimiter();
    constructor(options) {
        this.redis = options.redis;
        this.keyPrefix = options.keyPrefix ?? 'astro:ratelimit:';
    }
    async consume(key, limit, windowSeconds) {
        const fullKey = `${this.keyPrefix}${key}`;
        try {
            const res = (await this.redis.eval(REDIS_RATE_LIMIT_LUA, 1, fullKey, limit.toString(), windowSeconds.toString()));
            const current = Number(res[0]);
            const ttl = Math.max(1, Number(res[1]));
            if (current <= limit) {
                return {
                    allowed: true,
                    limit,
                    remaining: Math.max(0, limit - current),
                    resetSeconds: ttl,
                    retryAfterSeconds: 0,
                };
            }
            return {
                allowed: false,
                limit,
                remaining: 0,
                resetSeconds: ttl,
                retryAfterSeconds: ttl,
            };
        }
        catch (err) {
            logger.warn({ key: fullKey, err: err.message }, 'Redis rate limiter failed. Falling back to local in-memory limiter.');
            return this.memoryFallback.consume(key, limit, windowSeconds);
        }
    }
    async reset(key) {
        const fullKey = `${this.keyPrefix}${key}`;
        try {
            await this.redis.del(fullKey);
        }
        catch {
            // Ignored on teardown/fallback
        }
        await this.memoryFallback.reset(key);
    }
}
/**
 * Creates an Express middleware applying rate limiting and managing headers:
 * X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, and Retry-After (on 429).
 */
export function createRateLimitMiddleware(options) {
    const { limiter, limit, windowSeconds, prefix = 'general', keyGenerator, skip } = options;
    return async (req, res, next) => {
        try {
            if (skip && skip(req)) {
                return next();
            }
            const clientKey = keyGenerator
                ? keyGenerator(req)
                : req.ip || req.socket.remoteAddress || 'unknown-client';
            const compositeKey = `${prefix}:${clientKey}`;
            const result = await limiter.consume(compositeKey, limit, windowSeconds);
            res.setHeader('X-RateLimit-Limit', String(result.limit));
            res.setHeader('X-RateLimit-Remaining', String(result.remaining));
            res.setHeader('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000) + result.resetSeconds));
            if (!result.allowed) {
                res.setHeader('Retry-After', String(result.retryAfterSeconds));
                throw new RateLimitedError(`Rate limit exceeded. Please retry after ${result.retryAfterSeconds} seconds.`, result.retryAfterSeconds);
            }
            next();
        }
        catch (err) {
            next(err);
        }
    };
}
