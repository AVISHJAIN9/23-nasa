import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestMongo,
  teardownTestMongo,
  clearTestMongo,
  createTestApp,
  authHeader,
} from './helpers.js';

describe('Role-Based Access Control Matrix (F001 & Security)', () => {
  beforeAll(async () => {
    await setupTestMongo();
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();
  });

  it('enforces RBAC on POST /v1/users (Admin only)', async () => {
    const { agent } = createTestApp();
    const newUserPayload = {
      email: 'new.member@astrocare.nasa.gov',
      display_name: 'New Member',
      role: 'astronaut',
      password: 'StrongPassword#123',
    };

    // 1. No token -> 401
    const noTokenRes = await agent.post('/v1/users').send(newUserPayload);
    expect(noTokenRes.status).toBe(401);

    // 2. Wrong role (astronaut) -> 403
    const astronautRes = await agent
      .post('/v1/users')
      .set('Authorization', authHeader('astro-1', 'astronaut'))
      .send(newUserPayload);
    expect(astronautRes.status).toBe(403);

    // 3. Right role (admin) -> 201
    const adminRes = await agent
      .post('/v1/users')
      .set('Authorization', authHeader('admin-1', 'admin'))
      .send(newUserPayload);
    expect(adminRes.status).toBe(201);
  });

  it('enforces RBAC on GET /v1/users (Admin only)', async () => {
    const { agent } = createTestApp();

    const noTokenRes = await agent.get('/v1/users');
    expect(noTokenRes.status).toBe(401);

    const surgeonRes = await agent
      .get('/v1/users')
      .set('Authorization', authHeader('surgeon-1', 'flight_surgeon'));
    expect(surgeonRes.status).toBe(403);

    const adminRes = await agent
      .get('/v1/users')
      .set('Authorization', authHeader('admin-1', 'admin'));
    expect(adminRes.status).toBe(200);
  });

  it('enforces RBAC on GET /v1/crew (flight_surgeon, mission_control, admin)', async () => {
    const { agent } = createTestApp();

    // 1. No token -> 401
    const noTokenRes = await agent.get('/v1/crew');
    expect(noTokenRes.status).toBe(401);

    // 2. Astronaut (unauthorized for full list) -> 403
    const astronautRes = await agent
      .get('/v1/crew')
      .set('Authorization', authHeader('astro-1', 'astronaut'));
    expect(astronautRes.status).toBe(403);

    // 3. Authorized roles -> 200
    const surgeonRes = await agent
      .get('/v1/crew')
      .set('Authorization', authHeader('surgeon-1', 'flight_surgeon'));
    expect(surgeonRes.status).toBe(200);

    const controlRes = await agent
      .get('/v1/crew')
      .set('Authorization', authHeader('control-1', 'mission_control'));
    expect(controlRes.status).toBe(200);

    const adminRes = await agent
      .get('/v1/crew')
      .set('Authorization', authHeader('admin-1', 'admin'));
    expect(adminRes.status).toBe(200);
  });

  it('enforces RBAC on DELETE /v1/crew/:id (Admin only)', async () => {
    const { agent } = createTestApp();
    const fakeId = '6710d1fa73a11b0012c89012';

    const noTokenRes = await agent.delete(`/v1/crew/${fakeId}`);
    expect(noTokenRes.status).toBe(401);

    const surgeonRes = await agent
      .delete(`/v1/crew/${fakeId}`)
      .set('Authorization', authHeader('surgeon-1', 'flight_surgeon'));
    expect(surgeonRes.status).toBe(403);

    const adminRes = await agent
      .delete(`/v1/crew/${fakeId}`)
      .set('Authorization', authHeader('admin-1', 'admin'));
    // 404 because fakeId doesn't exist, but NOT 401 or 403 (authorization passed!)
    expect(adminRes.status).toBe(404);
  });
});
