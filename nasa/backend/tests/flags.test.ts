import { describe, it, expect } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import { getInitialFlags } from '../src/core/flags.js';

describe('Feature Flags Service & API (F141)', () => {
  describe('Defaults and environment overrides', () => {
    it('initializes with catalog defaults', () => {
      const flags = getInitialFlags({});

      expect(flags).toEqual({
        ml_enabled: true,
        llm_mode: 'auto',
        rules_only_fallback: false,
        demo_panel_enabled: true,
      });
    });

    it('respects ASTRO_FLAG_* environment overrides', () => {
      const flags = getInitialFlags({
        ASTRO_FLAG_ML_ENABLED: 'false',
        ASTRO_FLAG_LLM_MODE: 'local',
        ASTRO_FLAG_RULES_ONLY_FALLBACK: 'true',
        ASTRO_FLAG_DEMO_PANEL_ENABLED: 'false',
      });

      expect(flags).toEqual({
        ml_enabled: false,
        llm_mode: 'local',
        rules_only_fallback: true,
        demo_panel_enabled: false,
      });
    });
  });

  describe('GET /v1/flags', () => {
    it('returns all current feature flags', async () => {
      const { agent } = createTestApp({
        initialFlags: {
          ml_enabled: true,
          llm_mode: 'cloud',
          rules_only_fallback: false,
          demo_panel_enabled: true,
        },
      });

      const res = await agent.get('/v1/flags');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ml_enabled: true,
        llm_mode: 'cloud',
        rules_only_fallback: false,
        demo_panel_enabled: true,
      });
    });
  });

  describe('PUT /v1/flags/:name', () => {
    it('successfully updates a flag when admin JWT is provided', async () => {
      const { agent, flagService } = createTestApp();

      const res = await agent
        .put('/v1/flags/ml_enabled')
        .set('Authorization', authHeader('admin-user-id', 'admin'))
        .send({ value: false });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        name: 'ml_enabled',
        value: false,
      });

      expect(await flagService.get('ml_enabled')).toBe(false);
    });

    it('returns 403 FORBIDDEN when PUT is called with a non-admin role token', async () => {
      const { agent } = createTestApp();

      const res = await agent
        .put('/v1/flags/ml_enabled')
        .set('Authorization', authHeader('astronaut-user-id', 'astronaut'))
        .send({ value: false });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 401 UNAUTHENTICATED when PUT is called without any token', async () => {
      const { agent } = createTestApp();

      const res = await agent.put('/v1/flags/ml_enabled').send({ value: false });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 404 NOT_FOUND for unknown flag name', async () => {
      const { agent } = createTestApp();

      const res = await agent
        .put('/v1/flags/non_existent_flag')
        .set('Authorization', authHeader('admin-user-id', 'admin'))
        .send({ value: true });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toContain('non_existent_flag');
    });

    it('returns 422 VALIDATION_ERROR for invalid flag value type or enum', async () => {
      const { agent } = createTestApp();

      const res = await agent
        .put('/v1/flags/llm_mode')
        .set('Authorization', authHeader('admin-user-id', 'admin'))
        .send({ value: 'quantum_neural' }); // allowed: auto | cloud | local

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Invalid value');
    });
  });
});
