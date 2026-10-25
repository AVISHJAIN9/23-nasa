import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestMongo,
  teardownTestMongo,
  clearTestMongo,
  createTestApp,
  createTestUser,
} from './helpers.js';
import { User } from '../src/models/User.js';

describe('Authentication API (F001)', () => {
  beforeAll(async () => {
    await setupTestMongo();
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();
  });

  it('successfully logs in with valid credentials and sets secure cookie', async () => {
    const { rawPassword } = await createTestUser({
      email: 'pilot.armstrong@astrocare.nasa.gov',
      role: 'astronaut',
      is_medical_officer: false,
    });
    const { agent } = createTestApp();

    const res = await agent
      .post('/v1/auth/login')
      .send({ email: 'pilot.armstrong@astrocare.nasa.gov', password: rawPassword });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(900);
    expect(res.body.user).toMatchObject({
      email: 'pilot.armstrong@astrocare.nasa.gov',
      role: 'astronaut',
      is_medical_officer: false,
    });

    const cookieHeader = res.headers['set-cookie'];
    expect(cookieHeader).toBeDefined();
    const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    expect(cookie).toContain('refresh_token=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/v1/auth');
  });

  it('returns generic error on wrong password without disclosing email validity', async () => {
    const { user } = await createTestUser({ email: 'surgeon.vance@astrocare.nasa.gov' });
    const { agent } = createTestApp();

    const res = await agent
      .post('/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword#123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Invalid email or password',
    });
  });

  it('returns identical generic error on unknown email (constant-time verification)', async () => {
    const { agent } = createTestApp();

    const res = await agent
      .post('/v1/auth/login')
      .send({ email: 'nonexistent.user@astrocare.nasa.gov', password: 'SomePassword#123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Invalid email or password',
    });
  });

  it('rejects disabled accounts with 401 UNAUTHENTICATED', async () => {
    const { user, rawPassword } = await createTestUser({
      status: 'disabled',
    });
    const { agent } = createTestApp();

    const res = await agent
      .post('/v1/auth/login')
      .send({ email: user.email, password: rawPassword });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toContain('disabled');
  });

  it('locks out account after 5 consecutive failures and returns 429 with Retry-After', async () => {
    const { user } = await createTestUser({ email: 'target.astronaut@astrocare.nasa.gov' });
    const { agent } = createTestApp();

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      const res = await agent
        .post('/v1/auth/login')
        .send({ email: user.email, password: 'WrongPassword#999' });
      expect(res.status).toBe(401);
    }

    // 5th failed attempt: triggers 429 RATE_LIMITED
    const fifthRes = await agent
      .post('/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword#999' });

    expect(fifthRes.status).toBe(429);
    expect(fifthRes.body.error.code).toBe('RATE_LIMITED');
    expect(fifthRes.headers['retry-after']).toBeDefined();

    // 6th attempt (even with correct password) is blocked by lockout
    const sixthRes = await agent
      .post('/v1/auth/login')
      .send({ email: user.email, password: 'TestPassword#2026' });

    expect(sixthRes.status).toBe(429);
    expect(sixthRes.body.error.code).toBe('RATE_LIMITED');
    expect(sixthRes.headers['retry-after']).toBeDefined();
  });

  it('resets failed login counter upon a successful login', async () => {
    const { user, rawPassword } = await createTestUser();
    const { agent } = createTestApp();

    // 3 failed attempts
    for (let i = 0; i < 3; i++) {
      await agent.post('/v1/auth/login').send({ email: user.email, password: 'WrongPassword' });
    }

    const updatedUserBefore = await User.findById(user._id);
    expect(updatedUserBefore?.failed_login_count).toBe(3);

    // 4th attempt succeeds
    const successRes = await agent
      .post('/v1/auth/login')
      .send({ email: user.email, password: rawPassword });

    expect(successRes.status).toBe(200);

    const updatedUserAfter = await User.findById(user._id);
    expect(updatedUserAfter?.failed_login_count).toBe(0);
    expect(updatedUserAfter?.locked_until).toBeNull();
  });
});
