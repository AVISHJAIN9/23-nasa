import { describe, it, expect } from 'vitest';
import { Router } from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  BadRequestError,
  UnauthenticatedError,
  TokenExpiredError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitedError,
  InternalError,
  ServiceUnavailableError,
} from '../src/core/errors.js';
import { validate } from '../src/middleware/validate.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';
import { FlagService, InMemoryFlagStore } from '../src/core/flags.js';
import { ReadinessRegistry } from '../src/core/readiness.js';

describe('Error Contract & Exception Handling (F132)', () => {
  // Helper to mount test-only routes on an isolated test app
  function createErrorApp(routeSetup: (router: Router) => void) {
    const testRouter = Router();
    routeSetup(testRouter);

    const settings = parseConfig({ ASTRO_ENV: 'test', ASTRO_LOG_LEVEL: 'silent' });
    const flagService = new FlagService(new InMemoryFlagStore());
    const readinessRegistry = new ReadinessRegistry();

    const app = createApp({
      settings,
      flagService,
      readinessRegistry,
      customRouter: { path: '/test', router: testRouter },
    });

    return request(app);
  }

  describe('ErrorCode status mapping and contract shape', () => {
    it('handles BAD_REQUEST with status 400', async () => {
      const agent = createErrorApp((r) => {
        r.get('/bad-request', () => {
          throw new BadRequestError('Invalid query syntax');
        });
      });

      const res = await agent.get('/test/bad-request');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Invalid query syntax',
      });
      expect(res.body.error.request_id).toBeDefined();
    });

    it('handles UNAUTHENTICATED with status 401', async () => {
      const agent = createErrorApp((r) => {
        r.get('/unauthenticated', () => {
          throw new UnauthenticatedError('Crew authentication missing');
        });
      });

      const res = await agent.get('/test/unauthenticated');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Crew authentication missing',
      });
      expect(res.body.error.request_id).toBeDefined();
    });

    it('handles TOKEN_EXPIRED with status 401', async () => {
      const agent = createErrorApp((r) => {
        r.get('/token-expired', () => {
          throw new TokenExpiredError('Mission token expired');
        });
      });

      const res = await agent.get('/test/token-expired');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'TOKEN_EXPIRED',
        message: 'Mission token expired',
      });
      expect(res.body.error.request_id).toBeDefined();
    });

    it('handles FORBIDDEN with status 403', async () => {
      const agent = createErrorApp((r) => {
        r.get('/forbidden', () => {
          throw new ForbiddenError('Admin mission clearance required');
        });
      });

      const res = await agent.get('/test/forbidden');
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Admin mission clearance required',
      });
      expect(res.body.error.request_id).toBeDefined();
    });

    it('handles NOT_FOUND with status 404', async () => {
      const agent = createErrorApp((r) => {
        r.get('/not-found', () => {
          throw new NotFoundError('Astronaut bio-telemetry record not found');
        });
      });

      const res = await agent.get('/test/not-found');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Astronaut bio-telemetry record not found',
      });
      expect(res.body.error.request_id).toBeDefined();
    });

    it('handles CONFLICT with status 409', async () => {
      const agent = createErrorApp((r) => {
        r.get('/conflict', () => {
          throw new ConflictError('Concurrent medical triage lock active');
        });
      });

      const res = await agent.get('/test/conflict');
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'CONFLICT',
        message: 'Concurrent medical triage lock active',
      });
      expect(res.body.error.request_id).toBeDefined();
    });

    it('handles VALIDATION_ERROR with status 422', async () => {
      const agent = createErrorApp((r) => {
        r.get('/validation-error', () => {
          throw new ValidationError('Validation failed', [
            { field: 'body.dosage', issue: 'must be positive' },
          ]);
        });
      });

      const res = await agent.get('/test/validation-error');
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'body.dosage', issue: 'must be positive' }],
      });
      expect(res.body.error.request_id).toBeDefined();
    });

    it('handles RATE_LIMITED with status 429', async () => {
      const agent = createErrorApp((r) => {
        r.get('/rate-limited', () => {
          throw new RateLimitedError('Deep-space link bandwidth exceeded');
        });
      });

      const res = await agent.get('/test/rate-limited');
      expect(res.status).toBe(429);
      expect(res.body.error).toMatchObject({
        code: 'RATE_LIMITED',
        message: 'Deep-space link bandwidth exceeded',
      });
      expect(res.body.error.request_id).toBeDefined();
    });

    it('handles INTERNAL_ERROR with status 500', async () => {
      const agent = createErrorApp((r) => {
        r.get('/internal-error', () => {
          throw new InternalError('Database connection pool exhausted');
        });
      });

      const res = await agent.get('/test/internal-error');
      expect(res.status).toBe(500);
      expect(res.body.error).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Database connection pool exhausted',
      });
      expect(res.body.error.request_id).toBeDefined();
    });

    it('handles SERVICE_UNAVAILABLE with status 503', async () => {
      const agent = createErrorApp((r) => {
        r.get('/service-unavailable', () => {
          throw new ServiceUnavailableError('Telemetry satellite relay disconnected');
        });
      });

      const res = await agent.get('/test/service-unavailable');
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Telemetry satellite relay disconnected',
      });
      expect(res.body.error.request_id).toBeDefined();
    });
  });

  describe('Validation error with dotted field paths', () => {
    it('maps Zod errors from body, query, and params to dotted field paths', async () => {
      const agent = createErrorApp((r) => {
        r.post(
          '/vitals',
          validate({
            body: z.object({
              spo2: z.number().min(0).max(100, 'must be between 0 and 100'),
              crew: z.object({
                id: z.string().min(3, 'crew id too short'),
              }),
            }),
            query: z.object({
              priority: z.enum(['high', 'routine']),
            }),
          }),
          (_req, res) => res.json({ ok: true }),
        );
      });

      const res = await agent
        .post('/test/vitals?priority=invalid_priority')
        .send({ spo2: 150, crew: { id: 'x' } });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Request validation failed');

      const fields = res.body.error.details.map((d: { field: string }) => d.field);
      expect(fields).toContain('body.spo2');
      expect(fields).toContain('body.crew.id');
      expect(fields).toContain('query.priority');

      const spo2Detail = res.body.error.details.find(
        (d: { field: string }) => d.field === 'body.spo2',
      );
      expect(spo2Detail.issue).toContain('must be between 0 and 100');
    });
  });

  describe('Unhandled exceptions and security masking', () => {
    it('masks unhandled errors, hides stack trace and secrets, but retains request_id', async () => {
      const agent = createErrorApp((r) => {
        r.get('/crash', () => {
          throw new Error('FATAL SECRET: DB_PASSWORD=classified_mars_key');
        });
      });

      const res = await agent.get('/test/crash');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).not.toContain('classified_mars_key');
      expect(res.body.error.message).toBe(
        'An unexpected error occurred. Please contact mission support with the request ID.',
      );
      expect(res.body.error.details).toBeUndefined();
      expect(res.body.stack).toBeUndefined();
      expect(res.body.error.stack).toBeUndefined();
      expect(res.body.error.request_id).toBeDefined();
    });
  });

  describe('Malformed JSON body & unknown routes', () => {
    it('returns BAD_REQUEST error contract on malformed JSON payload', async () => {
      const settings = parseConfig({ ASTRO_ENV: 'test', ASTRO_LOG_LEVEL: 'silent' });
      const app = createApp({ settings });
      const agent = request(app);

      const res = await agent
        .post('/v1/flags/ml_enabled')
        .set('Content-Type', 'application/json')
        .send('{"value": true, invalid json');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Malformed JSON payload in request body',
      });
      expect(res.body.error.request_id).toBeDefined();
    });

    it('returns NOT_FOUND error contract on unknown route', async () => {
      const settings = parseConfig({ ASTRO_ENV: 'test', ASTRO_LOG_LEVEL: 'silent' });
      const app = createApp({ settings });
      const agent = request(app);

      const res = await agent.get('/v1/does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(res.body.error.message).toContain('/v1/does-not-exist');
      expect(res.body.error.request_id).toBeDefined();
    });
  });
});
