import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { createTestApp, setupTestMongo, teardownTestMongo } from './helpers.js';
import { ReadinessRegistry } from '../src/core/readiness.js';
import { registerMongoReadinessCheck } from '../src/core/db.js';

describe('Health Endpoints (Liveness and Readiness)', () => {
  describe('GET /health (Liveness Probe)', () => {
    it('returns status: ok with HTTP 200', async () => {
      const { agent } = createTestApp();

      const res = await agent.get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /v1/health/ready (Readiness Probe)', () => {
    it('returns 200 with complete system diagnostics when all checks pass', async () => {
      const readinessRegistry = new ReadinessRegistry();
      readinessRegistry.registerCheck('telemetry_link', async () => ({
        ok: true,
        message: 'DSN link active (delay: 720s)',
      }));

      const { agent, settings } = createTestApp({
        readinessRegistry,
      });

      const res = await agent.get('/v1/health/ready');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.version).toBe(settings.app_version);
      expect(res.body.mission_mode).toBe(settings.mission_mode);
      expect(res.body.flags).toBeDefined();
      expect(res.body.checks.telemetry_link).toMatchObject({
        ok: true,
        message: 'DSN link active (delay: 720s)',
      });
      expect(typeof res.body.checks.telemetry_link.duration_ms).toBe('number');
    });

    it('returns 503 SERVICE_UNAVAILABLE when any registered check fails', async () => {
      const readinessRegistry = new ReadinessRegistry();
      readinessRegistry.registerCheck('database', async () => ({
        ok: true,
        message: 'Connected',
      }));
      readinessRegistry.registerCheck('redis_cache', async () => ({
        ok: false,
        message: 'Connection timed out',
      }));

      const { agent } = createTestApp({
        readinessRegistry,
      });

      const res = await agent.get('/v1/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Readiness check failed: one or more subsystems are not ready',
      });

      const failedFields = res.body.error.details.map((d: { field: string }) => d.field);
      expect(failedFields).toContain('checks.redis_cache');
    });

    it('returns 503 SERVICE_UNAVAILABLE when a check throws an exception', async () => {
      const readinessRegistry = new ReadinessRegistry();
      readinessRegistry.registerCheck('ml_inference_sidecar', async () => {
        throw new Error('Inference server offline (ECONNREFUSED)');
      });

      const { agent } = createTestApp({
        readinessRegistry,
      });

      const res = await agent.get('/v1/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'checks.ml_inference_sidecar',
            issue: 'Inference server offline (ECONNREFUSED)',
          }),
        ]),
      );
    });

    it('verifies mongodb readiness check fails when disconnected and passes when connected', async () => {
      const readinessRegistry = new ReadinessRegistry();
      registerMongoReadinessCheck(readinessRegistry);

      // Ensure mongoose is disconnected
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }

      const { agent } = createTestApp({ readinessRegistry });

      // 1. Disconnected -> 503 SERVICE_UNAVAILABLE
      const failRes = await agent.get('/v1/health/ready');
      expect(failRes.status).toBe(503);
      expect(failRes.body.error.code).toBe('SERVICE_UNAVAILABLE');
      const failedFields = failRes.body.error.details.map((d: { field: string }) => d.field);
      expect(failedFields).toContain('checks.mongodb');

      // 2. Connect to in-memory DB -> 200 OK
      await setupTestMongo();
      const passRes = await agent.get('/v1/health/ready');
      expect(passRes.status).toBe(200);
      expect(passRes.body.checks.mongodb).toMatchObject({
        ok: true,
        message: 'Connected',
      });

      await teardownTestMongo();
    });
  });
});
