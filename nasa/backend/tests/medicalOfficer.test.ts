import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Router } from 'express';
import request from 'supertest';
import {
  setupTestMongo,
  teardownTestMongo,
  clearTestMongo,
  createTestApp,
  createTestUser,
  authHeader,
} from './helpers.js';
import { requireMedicalAccess } from '../src/core/security.js';
import { verifyAccessToken } from '../src/core/tokens.js';
import { createApp } from '../src/app.js';
import { InMemoryAuditWriter } from '../src/core/audit.js';

describe('Crew Medical Officer Mode & Medical Access (F066)', () => {
  beforeAll(async () => {
    await setupTestMongo();
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();
  });

  it('grants and revokes medical officer designation and records audit entries', async () => {
    const auditWriter = new InMemoryAuditWriter();
    const { user: astronaut } = await createTestUser({ role: 'astronaut' });
    const { user: admin } = await createTestUser({ role: 'admin' });
    const { agent } = createTestApp({ auditWriter });

    // 1. Grant medical officer status
    const grantRes = await agent
      .put(`/v1/users/${astronaut.id}/medical-officer`)
      .set('Authorization', authHeader(admin.id, 'admin'))
      .send({ enabled: true });

    expect(grantRes.status).toBe(200);
    expect(grantRes.body.is_medical_officer).toBe(true);

    expect(auditWriter.entries.length).toBe(1);
    expect(auditWriter.entries[0]).toMatchObject({
      actor_id: admin.id,
      action: 'MEDICAL_OFFICER_GRANTED',
      target_id: astronaut.id,
    });

    // 2. Revoke medical officer status
    const revokeRes = await agent
      .put(`/v1/users/${astronaut.id}/medical-officer`)
      .set('Authorization', authHeader(admin.id, 'admin'))
      .send({ enabled: false });

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.is_medical_officer).toBe(false);

    expect(auditWriter.entries.length).toBe(2);
    expect(auditWriter.entries[1]).toMatchObject({
      actor_id: admin.id,
      action: 'MEDICAL_OFFICER_REVOKED',
      target_id: astronaut.id,
    });
  });

  it('rejects medical officer designation on non-astronaut roles with 422 VALIDATION_ERROR', async () => {
    const { user: surgeon } = await createTestUser({ role: 'flight_surgeon' });
    const { user: admin } = await createTestUser({ role: 'admin' });
    const { agent } = createTestApp();

    const res = await agent
      .put(`/v1/users/${surgeon.id}/medical-officer`)
      .set('Authorization', authHeader(admin.id, 'admin'))
      .send({ enabled: true });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('astronaut');
  });

  it('ensures new access tokens carry mo: true when logging in as medical officer', async () => {
    const { user, rawPassword } = await createTestUser({
      role: 'astronaut',
      is_medical_officer: true,
    });
    const { agent, settings } = createTestApp();

    const loginRes = await agent
      .post('/v1/auth/login')
      .send({ email: user.email, password: rawPassword });

    expect(loginRes.status).toBe(200);
    const token = loginRes.body.access_token;

    const decoded = verifyAccessToken(token, settings.jwt_access_secret);
    expect(decoded.mo).toBe(true);
    expect(decoded.role).toBe('astronaut');
  });

  it('requireMedicalAccess middleware authorizes flight_surgeon, admin, and MO astronaut, denying others', async () => {
    const testRouter = Router();
    testRouter.get('/triage', requireMedicalAccess(), (_req, res) =>
      res.json({ access: 'granted' }),
    );

    const { settings } = createTestApp();
    const app = createApp({
      settings,
      customRouter: { path: '/test-medical', router: testRouter },
    });
    const agent = request(app);

    // 1. Flight Surgeon -> Allowed (200)
    const surgeonRes = await agent
      .get('/test-medical/triage')
      .set('Authorization', authHeader('surgeon-1', 'flight_surgeon'));
    expect(surgeonRes.status).toBe(200);

    // 2. Admin -> Allowed (200)
    const adminRes = await agent
      .get('/test-medical/triage')
      .set('Authorization', authHeader('admin-1', 'admin'));
    expect(adminRes.status).toBe(200);

    // 3. Astronaut WITH isMedicalOfficer -> Allowed (200)
    const moRes = await agent
      .get('/test-medical/triage')
      .set('Authorization', authHeader('astro-mo', 'astronaut', true));
    expect(moRes.status).toBe(200);

    // 4. Regular Astronaut without MO -> Forbidden (403)
    const regularAstroRes = await agent
      .get('/test-medical/triage')
      .set('Authorization', authHeader('astro-reg', 'astronaut', false));
    expect(regularAstroRes.status).toBe(403);

    // 5. Mission Control -> Forbidden (403)
    const controlRes = await agent
      .get('/test-medical/triage')
      .set('Authorization', authHeader('control-1', 'mission_control'));
    expect(controlRes.status).toBe(403);
  });
});
