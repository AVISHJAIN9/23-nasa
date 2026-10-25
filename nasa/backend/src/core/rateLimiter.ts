import type { Request, Response, NextFunction } from 'express';
import { type Redis } from 'ioredis';
import { RateLimitedError } from './errors.js';
import { logger } from './logger.js';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
  close?(): Promise<void>;
}

/**
 * In-memory rate limiter with lazy TTL expiration.
 * Used for development, testing, and automatic failover when Redis is unreachable.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly store = new Map<string, { count: number; resetAt: number }>();

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
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

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
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
export class RedisRateLimiter implements RateLimiter {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly memoryFallback = new MemoryRateLimiter();

  constructor(options: { redis: Redis; keyPrefix?: string }) {
    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix ?? 'astro:ratelimit:';
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const fullKey = `${this.keyPrefix}${key}`;
    try {
      const res = (await this.redis.eval(
        REDIS_RATE_LIMIT_LUA,
        1,
        fullKey,
        limit.toString(),
        windowSeconds.toString(),
      )) as [number, number];

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
    } catch (err) {
      logger.warn(
        { key: fullKey, err: (err as Error).message },
        'Redis rate limiter failed. Falling back to local in-memory limiter.',
      );
      return this.memoryFallback.consume(key, limit, windowSeconds);
    }
  }

  async reset(key: string): Promise<void> {
    const fullKey = `${this.keyPrefix}${key}`;
    try {
      await this.redis.del(fullKey);
    } catch {
      // Ignored on teardown/fallback
    }
    await this.memoryFallback.reset(key);
  }
}

export interface RateLimitMiddlewareOptions {
  limiter: RateLimiter;
  limit: number;
  windowSeconds: number;
  prefix?: string;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

/**
 * Creates an Express middleware applying rate limiting and managing headers:
 * X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, and Retry-After (on 429).
 */
export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions) {
  const { limiter, limit, windowSeconds, prefix = 'general', keyGenerator, skip } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
      res.setHeader(
        'X-RateLimit-Reset',
        String(Math.ceil(Date.now() / 1000) + result.resetSeconds),
      );

      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
        throw new RateLimitedError(
          `Rate limit exceeded. Please retry after ${result.retryAfterSeconds} seconds.`,
          result.retryAfterSeconds,
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
