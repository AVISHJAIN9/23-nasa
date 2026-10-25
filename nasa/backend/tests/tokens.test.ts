import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { signAccessToken, verifyAccessToken, hashRefreshToken } from '../src/core/tokens.js';
import {
  setupTestMongo,
  teardownTestMongo,
  clearTestMongo,
  createTestApp,
  createTestUser,
} from './helpers.js';
import { RefreshToken } from '../src/models/RefreshToken.js';

describe('Token Lifecycle, Cryptography & Rotation (F001)', () => {
  const secret = 'test_secret_32_characters_minimum_length!';

  beforeAll(async () => {
    await setupTestMongo();
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();
  });

  describe('JWT Access Tokens', () => {
    it('signs and verifies valid access tokens with expected claims', () => {
      const token = signAccessToken(
        { userId: '6710d1fa73a11b0012c89012', role: 'flight_surgeon', isMedicalOfficer: false },
        secret,
        '15m',
      );

      const decoded = verifyAccessToken(token, secret);
      expect(decoded.sub).toBe('6710d1fa73a11b0012c89012');
      expect(decoded.role).toBe('flight_surgeon');
      expect(decoded.mo).toBe(false);
      expect(decoded.exp).toBeDefined();
    });

    it('throws TOKEN_EXPIRED when access token has expired', () => {
      const expiredToken = signAccessToken(
        { userId: '6710d1fa73a11b0012c89012', role: 'astronaut', isMedicalOfficer: true },
        secret,
        '-1s',
      );

      expect(() => {
        verifyAccessToken(expiredToken, secret);
      }).toThrowError(/expired/);
    });

    it('throws UNAUTHENTICATED on tampered token signature or payload', () => {
      const token = signAccessToken(
        { userId: '6710d1fa73a11b0012c89012', role: 'astronaut', isMedicalOfficer: false },
        secret,
        '15m',
      );

      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.${parts[1]}.badsignature12345`;

      expect(() => {
        verifyAccessToken(tamperedToken, secret);
      }).toThrowError(/Invalid or malformed access token/);
    });

    it('strictly rejects tokens with "alg: none"', () => {
      // Craft an unverified token with alg: none
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'admin-id',
          role: 'admin',
          mo: false,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url');
      const noneAlgToken = `${header}.${payload}.`;

      expect(() => {
        verifyAccessToken(noneAlgToken, secret);
      }).toThrowError(/Invalid or malformed access token/);
    });
  });

  describe('Refresh Token Family Rotation & Reuse Detection', () => {
    it('performs refresh rotation issuing new access token and rotated cookie', async () => {
      const { user, rawPassword } = await createTestUser({ role: 'astronaut' });
      const { agent } = createTestApp();

      const loginRes = await agent
        .post('/v1/auth/login')
        .send({ email: user.email, password: rawPassword });

      expect(loginRes.status).toBe(200);
      const cookieHeader = loginRes.headers['set-cookie'];
      expect(cookieHeader).toBeDefined();
      const rawCookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;

      // Extract raw token from cookie
      const match = rawCookie?.match(/refresh_token=([^;]+)/);
      const firstRefreshToken = match?.[1];
      expect(firstRefreshToken).toBeDefined();

      // Refresh using cookie
      const refreshRes = await agent
        .post('/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${firstRefreshToken}`]);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.access_token).toBeDefined();
      expect(refreshRes.body.user.email).toBe(user.email);

      // Verify old token is marked used
      const oldDoc = await RefreshToken.findOne({
        token_hash: hashRefreshToken(firstRefreshToken!),
      });
      expect(oldDoc?.used_at).not.toBeNull();
    });

    it('detects refresh token reuse, revoking entire family and rejecting with 401', async () => {
      const { user, rawPassword } = await createTestUser({ role: 'astronaut' });
      const { agent } = createTestApp();

      const loginRes = await agent
        .post('/v1/auth/login')
        .send({ email: user.email, password: rawPassword });

      const cookieHeader = loginRes.headers['set-cookie'];
      const rawCookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
      const stolenToken = rawCookie?.match(/refresh_token=([^;]+)/)?.[1];

      // First refresh: legit use
      const firstRefresh = await agent
        .post('/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${stolenToken}`]);
      expect(firstRefresh.status).toBe(200);

      // Second refresh with old token: reuse attempt by adversary!
      const reuseRes = await agent
        .post('/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${stolenToken}`]);

      expect(reuseRes.status).toBe(401);
      expect(reuseRes.body.error.code).toBe('UNAUTHENTICATED');
      expect(reuseRes.body.error.message).toContain('reuse detected');

      // Verify all tokens in that family were revoked
      const familyDoc = await RefreshToken.findOne({ token_hash: hashRefreshToken(stolenToken!) });
      const familyTokens = await RefreshToken.find({ family_id: familyDoc?.family_id });
      for (const tok of familyTokens) {
        expect(tok.revoked_at).not.toBeNull();
      }
    });

    it('invalidates refresh token on logout', async () => {
      const { user, rawPassword } = await createTestUser({ role: 'flight_surgeon' });
      const { agent } = createTestApp();

      const loginRes = await agent
        .post('/v1/auth/login')
        .send({ email: user.email, password: rawPassword });

      const cookieHeader = loginRes.headers['set-cookie'];
      const token = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)?.match(
        /refresh_token=([^;]+)/,
      )?.[1];

      const logoutRes = await agent
        .post('/v1/auth/logout')
        .set('Cookie', [`refresh_token=${token}`]);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body).toEqual({ status: 'ok' });

      // Token in DB is revoked
      const doc = await RefreshToken.findOne({ token_hash: hashRefreshToken(token!) });
      expect(doc?.revoked_at).not.toBeNull();

      // Subsequent refresh fails
      const refreshRes = await agent
        .post('/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${token}`]);
      expect(refreshRes.status).toBe(401);
    });
  });
});
