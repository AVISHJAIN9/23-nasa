import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { createTestApp, createTestUser, authHeader } from './helpers.js';
import { connectMongo, disconnectMongo } from '../src/core/db.js';
import { MongoAuditWriter, verifyAuditLedger, canonicalJson } from '../src/core/audit.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { User } from '../src/models/User.js';
import { MemoryRateLimiter } from '../src/core/rateLimiter.js';

describe('Phase 5 — Security & Integrity Attack Test Suite', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectMongo(mongoServer.getUri());
  });

  afterAll(async () => {
    await disconnectMongo();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // --------------------------------------------------------------------------
  // 1. AUTH BYPASS TESTS
  // --------------------------------------------------------------------------
  describe('1. Authentication Bypass Resistance', () => {
    it('rejects unauthenticated requests to protected endpoints with 401 UNAUTHENTICATED', async () => {
      const { agent } = createTestApp();

      const endpoints = [
        { method: 'get', path: '/v1/users' },
        { method: 'get', path: '/v1/inbox' },
        { method: 'get', path: '/v1/protocols/decisions' },
        { method: 'get', path: '/v1/audit/verify' },
      ];

      for (const ep of endpoints) {
        const res = await agent[ep.method as 'get'](ep.path);
        expect(res.status).toBe(401);
        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
        expect(res.headers['x-request-id']).toBeDefined();
      }
    });

    it('rejects malformed Bearer authorization headers with 401 UNAUTHENTICATED', async () => {
      const { agent } = createTestApp();

      const badHeaders = [
        'Basic dXNlcjpwYXNz',
        'Bearer',
        'Bearer not-a-valid-jwt-token',
        'Token some-random-string',
      ];

      for (const header of badHeaders) {
        const res = await agent.get('/v1/users').set('Authorization', header);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. JWT TAMPERING TESTS
  // --------------------------------------------------------------------------
  describe('2. JWT Tampering & Algorithm Insecurity', () => {
    it('rejects tokens signed with an unauthorized external key', async () => {
      const { agent } = createTestApp();
      const foreignSecret = 'an_attacker_controlled_secret_key_that_does_not_match!';

      const forgedToken = jwt.sign(
        { sub: 'attacker-id', role: 'admin', is_medical_officer: true },
        foreignSecret,
        { algorithm: 'HS256', expiresIn: '1h' },
      );

      const res = await agent.get('/v1/users').set('Authorization', `Bearer ${forgedToken}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects algorithm "none" unsigned token attacks', async () => {
      const { agent } = createTestApp();

      // Algorithm "none" attack token header and payload
      const headerB64 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url',
      );
      const payloadB64 = Buffer.from(
        JSON.stringify({ sub: 'admin-id', role: 'admin', is_medical_officer: true }),
      ).toString('base64url');
      const unsignedNoneToken = `${headerB64}.${payloadB64}.`;

      const res = await agent.get('/v1/users').set('Authorization', `Bearer ${unsignedNoneToken}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects signature truncation and byte flipping tampering', async () => {
      const { agent, settings } = createTestApp();
      const { user } = await createTestUser({ role: 'admin' });

      const validToken = jwt.sign({ sub: user.id, role: user.role }, settings.jwt_access_secret, {
        algorithm: 'HS256',
        expiresIn: '1h',
      });

      // Flip the last 4 characters of signature
      const tamperedToken = validToken.slice(0, -4) + 'XXXX';

      const res = await agent.get('/v1/users').set('Authorization', `Bearer ${tamperedToken}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  // --------------------------------------------------------------------------
  // 3. IDOR ACROSS CREW PROFILES
  // --------------------------------------------------------------------------
  describe('3. Insecure Direct Object Reference (IDOR) Across Crew', () => {
    it('forbids an astronaut from submitting telemetry for another crew profile', async () => {
      const { agent } = createTestApp();

      // Create astronaut Alice linked to CrewProfile A
      const { user: aliceUser } = await createTestUser({ role: 'astronaut' });
      const crewAlice = await CrewProfile.create({
        user_id: aliceUser.id,
        name: 'Alice Astronaut',
        callsign: 'ASTRO-A',
        flight_role: 'Commander',
        age: 35,
        sex: 'female',
        height_cm: 172,
        weight_kg: 68,
      });
      aliceUser.crew_profile_id = crewAlice._id;
      await aliceUser.save();

      // Create astronaut Bob linked to CrewProfile B
      const { user: bobUser } = await createTestUser({ role: 'astronaut' });
      const crewBob = await CrewProfile.create({
        user_id: bobUser.id,
        name: 'Bob Astronaut',
        callsign: 'ASTRO-B',
        flight_role: 'Pilot',
        age: 38,
        sex: 'male',
        height_cm: 180,
        weight_kg: 80,
      });
      bobUser.crew_profile_id = crewBob._id;
      await bobUser.save();

      // Alice attempts to ingest telemetry readings tagged with Bob's crew_id
      const idorPayload = {
        batch_id: 'idor-attack-batch-001',
        readings: [
          {
            crew_id: String(crewBob._id), // Bob's profile!
            metric: 'heart_rate',
            value: 120,
            timestamp: new Date().toISOString(),
            source: 'simulated',
          },
        ],
      };

      const res = await agent
        .post('/v1/telemetry')
        .set('Authorization', authHeader(aliceUser.id, 'astronaut'))
        .send(idorPayload);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain(
        'Astronaut is only authorized to submit telemetry for their own crew profile',
      );
    });
  });

  // --------------------------------------------------------------------------
  // 4. REPLAYED REFRESH TOKENS & REUSE DETECTION
  // --------------------------------------------------------------------------
  describe('4. Refresh Token Replay & Family Revocation', () => {
    it('revokes the entire token family when a refresh token replay is detected', async () => {
      const { agent } = createTestApp();
      const testEmail = `refresh-attack-${Date.now()}@nasa.gov`;
      const testPassword = 'StrongPassword#2026';

      await User.create({
        email: testEmail,
        display_name: 'Dr. Test Replay',
        role: 'flight_surgeon',
        password_hash: await import('../src/core/passwords.js').then((m) =>
          m.hashPassword(testPassword),
        ),
      });

      // 1. Initial Login
      const loginRes = await agent.post('/v1/auth/login').send({
        email: testEmail,
        password: testPassword,
      });
      expect(loginRes.status).toBe(200);

      const cookie1 = loginRes.headers['set-cookie']?.find((c: string) =>
        c.startsWith('refresh_token='),
      );
      expect(cookie1).toBeDefined();

      // 2. Legitimate Refresh: Exchange cookie1 -> produces cookie2
      const refreshRes1 = await agent.post('/v1/auth/refresh').set('Cookie', cookie1!);
      expect(refreshRes1.status).toBe(200);
      const cookie2 = refreshRes1.headers['set-cookie']?.find((c: string) =>
        c.startsWith('refresh_token='),
      );
      expect(cookie2).toBeDefined();
      expect(cookie2).not.toBe(cookie1);

      // 3. Attack: Attacker steals and replays the already-used cookie1
      const replayRes = await agent.post('/v1/auth/refresh').set('Cookie', cookie1!);
      expect(replayRes.status).toBe(401);
      expect(replayRes.body.error.code).toBe('UNAUTHENTICATED');
      expect(replayRes.body.error.message).toContain('Refresh token reuse detected');

      // 4. Verification: The legitimate user holding cookie2 is now also revoked
      const subsequentRes = await agent.post('/v1/auth/refresh').set('Cookie', cookie2!);
      expect(subsequentRes.status).toBe(401);
      expect(subsequentRes.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  // --------------------------------------------------------------------------
  // 5. OVERSIZED PAYLOADS & DOS MITIGATION
  // --------------------------------------------------------------------------
  describe('5. Oversized Payload & DoS Mitigation', () => {
    it('rejects HTTP request bodies exceeding the 1MB payload limit with 400 BAD_REQUEST', async () => {
      const { agent } = createTestApp();
      const { user } = await createTestUser({ role: 'admin' });

      // Generate a payload exceeding 1MB (e.g. 1.2MB of junk characters)
      const hugeString = 'X'.repeat(1.2 * 1024 * 1024);

      const res = await agent
        .post('/v1/telemetry')
        .set('Authorization', authHeader(user.id, 'admin'))
        .set('Content-Type', 'application/json')
        .send(`{"batch_id":"huge","junk":"${hugeString}"}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
      expect(res.body.error.message).toContain('maximum size limit');
    });

    it('rejects telemetry batches with more than 500 readings with 422 VALIDATION_ERROR', async () => {
      const { agent, settings } = createTestApp();

      const excessiveReadings = Array.from({ length: 501 }, (_, i) => ({
        crew_id: `crew-${i}`,
        metric: 'heart_rate',
        value: 72,
        unit: 'bpm',
        source: 'chest_strap',
        recorded_at: new Date().toISOString(),
      }));

      const res = await agent
        .post('/v1/telemetry')
        .set('X-Ingest-Key', settings.ingest_api_key)
        .send({
          batch_id: 'excessive-batch-501',
          readings: excessiveReadings,
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // 6. INJECTION ATTACKS (NoSQL & XSS)
  // --------------------------------------------------------------------------
  describe('6. Injection Attack Neutralization', () => {
    it('rejects NoSQL query operator injection in request bodies with 422 VALIDATION_ERROR', async () => {
      const { agent } = createTestApp();

      // Attacker sends { "$gt": "" } to bypass email match in login
      const res = await agent.post('/v1/auth/login').send({
        email: { $gt: '' },
        password: 'password123',
      });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toBeDefined();
    });

    it('neutralizes HTML and script tags in user metadata fields without execution', async () => {
      const { agent } = createTestApp();
      const { user: admin } = await createTestUser({ role: 'admin' });

      const xssPayload = "<script>alert('xss-exploit')</script>";
      const createRes = await agent
        .post('/v1/users')
        .set('Authorization', authHeader(admin.id, 'admin'))
        .send({
          email: `xss-test-${Date.now()}@nasa.gov`,
          display_name: xssPayload,
          role: 'astronaut',
          password: 'SecurePassword#2026',
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.display_name).toBe(xssPayload); // Safely treated as text
    });
  });

  // --------------------------------------------------------------------------
  // 7. HASH-CHAINED AUDIT LEDGER INTEGRITY & MUTATION DETECTION
  // --------------------------------------------------------------------------
  describe('7. Hash-Chained Audit Ledger Tampering Detection', () => {
    it('detects record modification and breaks in the cryptographic hash chain', async () => {
      await AuditLog.deleteMany({});
      const writer = new MongoAuditWriter();

      // Write 3 contiguous blocks
      await writer.write({
        actor_id: 'user-001',
        action: 'USER_CREATED',
        target_id: 'target-001',
        metadata: { role: 'astronaut' },
      });

      await writer.write({
        actor_id: 'user-001',
        action: 'MEDICAL_OFFICER_GRANTED',
        target_id: 'target-001',
        metadata: { approved_by: 'flight_surgeon' },
      });

      await writer.write({
        actor_id: 'user-002',
        action: 'PRESCRIPTION_LOGGED',
        target_id: 'target-001',
        metadata: { drug: 'epinephrine' },
      });

      // 1. Initial verification must pass 100%
      const initialVerification = await verifyAuditLedger();
      expect(initialVerification.valid).toBe(true);
      expect(initialVerification.total_records).toBe(3);
      expect(initialVerification.verified_count).toBe(3);

      // 2. Tampering Attack: Mutate block #2 directly in MongoDB
      const block2 = await AuditLog.findOne({ sequence_number: 2 });
      expect(block2).not.toBeNull();

      // Attacker maliciously alters action without recomputing hash
      block2!.action = 'UNAUTHORIZED_PRIVILEGE_ELEVATION';
      await block2!.save();

      // 3. Verification must immediately catch the tampering!
      const tamperedVerification = await verifyAuditLedger();
      expect(tamperedVerification.valid).toBe(false);
      expect(tamperedVerification.broken_at_sequence).toBe(2);
      expect(tamperedVerification.reason).toBe('HASH_MISMATCH');
      expect(tamperedVerification.details).toBeDefined();

      // 4. Verify API endpoint GET /v1/audit/verify returns the tampering detection report
      const { agent } = createTestApp({ auditWriter: writer });
      const { user: surgeon } = await createTestUser({ role: 'flight_surgeon' });

      const apiRes = await agent
        .get('/v1/audit/verify')
        .set('Authorization', authHeader(surgeon.id, 'flight_surgeon'));

      expect(apiRes.status).toBe(200);
      expect(apiRes.body.valid).toBe(false);
      expect(apiRes.body.broken_at_sequence).toBe(2);
    });

    it('detects deleted block sequence gaps in the ledger', async () => {
      await AuditLog.deleteMany({});
      const writer = new MongoAuditWriter();

      await writer.write({ actor_id: 'u1', action: 'STEP_1', target_id: 't1' });
      await writer.write({ actor_id: 'u1', action: 'STEP_2', target_id: 't1' });
      await writer.write({ actor_id: 'u1', action: 'STEP_3', target_id: 't1' });

      // Malicious insider deletes block sequence #2
      await AuditLog.deleteOne({ sequence_number: 2 });

      const gapVerification = await verifyAuditLedger();
      expect(gapVerification.valid).toBe(false);
      expect(gapVerification.reason).toBe('SEQUENCE_GAP');
      expect(gapVerification.broken_at_sequence).toBe(3); // Sequence 3 found where 2 was expected
    });
  });

  // --------------------------------------------------------------------------
  // 8. REDIS / DISTRIBUTED RATE LIMITING BURST WITH RETRY-AFTER
  // --------------------------------------------------------------------------
  describe('8. Distributed Rate Limiting & 429 Contract', () => {
    it('throttles rapid burst requests, returns 429 RATE_LIMITED, and sets Retry-After header', async () => {
      const limiter = new MemoryRateLimiter();
      const { agent } = createTestApp({
        rateLimiter: limiter,
        customSettings: {
          rate_limit_enabled: true,
          rate_limit_max_requests: 3,
          rate_limit_window_s: 60,
        },
      });

      // Request 1: Allowed (remaining: 2)
      const res1 = await agent.get('/v1/flags');
      expect(res1.status).toBe(200);
      expect(res1.headers['x-ratelimit-limit']).toBe('3');
      expect(res1.headers['x-ratelimit-remaining']).toBe('2');

      // Request 2: Allowed (remaining: 1)
      const res2 = await agent.get('/v1/flags');
      expect(res2.status).toBe(200);
      expect(res2.headers['x-ratelimit-remaining']).toBe('1');

      // Request 3: Allowed (remaining: 0)
      const res3 = await agent.get('/v1/flags');
      expect(res3.status).toBe(200);
      expect(res3.headers['x-ratelimit-remaining']).toBe('0');

      // Request 4: Throttled!
      const res4 = await agent.get('/v1/flags');
      expect(res4.status).toBe(429);
      expect(res4.body.error.code).toBe('RATE_LIMITED');
      expect(res4.headers['retry-after']).toBeDefined();
      expect(Number(res4.headers['retry-after'])).toBeGreaterThan(0);
      expect(res4.headers['x-request-id']).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 9. HMAC TELEMETRY SIGNING
  // --------------------------------------------------------------------------
  describe('9. HMAC Telemetry Batch Signing', () => {
    let testCrewId: string;

    beforeAll(async () => {
      const crew = await CrewProfile.create({
        name: 'HMAC Specialist',
        callsign: 'ASTRO-HMAC',
        flight_role: 'Payload Specialist',
        age: 33,
        sex: 'female',
        height_cm: 169,
        weight_kg: 61,
      });
      testCrewId = String(crew._id);
    });

    it('accepts telemetry with valid HMAC-SHA256 signature from machine client', async () => {
      const hmacSecret = 'top_secret_hmac_signing_key_for_spacecraft_bus_2026!';
      const { agent, settings } = createTestApp({
        customSettings: {
          telemetry_hmac_secret: hmacSecret,
        },
      });

      const payload = {
        batch_id: 'hmac-valid-batch-001',
        readings: [
          {
            crew_id: testCrewId,
            metric: 'heart_rate',
            value: 78,
            timestamp: new Date().toISOString(),
            source: 'simulated',
          },
        ],
      };

      const payloadCanonical = canonicalJson(payload);
      const signature = crypto
        .createHmac('sha256', hmacSecret)
        .update(payloadCanonical, 'utf8')
        .digest('hex');

      const res = await agent
        .post('/v1/telemetry')
        .set('X-Ingest-Key', settings.ingest_api_key)
        .set('X-Telemetry-Signature', `sha256=${signature}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(1);
    });

    it('rejects telemetry with invalid or tampered HMAC signature with 401 UNAUTHENTICATED', async () => {
      const hmacSecret = 'top_secret_hmac_signing_key_for_spacecraft_bus_2026!';
      const { agent, settings } = createTestApp({
        customSettings: {
          telemetry_hmac_secret: hmacSecret,
        },
      });

      const payload = {
        batch_id: 'hmac-tampered-batch-001',
        readings: [
          {
            crew_id: testCrewId,
            metric: 'heart_rate',
            value: 80,
            timestamp: new Date().toISOString(),
            source: 'simulated',
          },
        ],
      };

      const invalidSignature = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const res = await agent
        .post('/v1/telemetry')
        .set('X-Ingest-Key', settings.ingest_api_key)
        .set('X-Telemetry-Signature', invalidSignature)
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.error.message).toContain('Invalid telemetry HMAC signature');
    });

    it('rejects unsigned telemetry when telemetry_hmac_required is enabled', async () => {
      const hmacSecret = 'top_secret_hmac_signing_key_for_spacecraft_bus_2026!';
      const { agent, settings } = createTestApp({
        customSettings: {
          telemetry_hmac_secret: hmacSecret,
          telemetry_hmac_required: true,
        },
      });

      const payload = {
        batch_id: 'hmac-missing-sig-001',
        readings: [
          {
            crew_id: testCrewId,
            metric: 'heart_rate',
            value: 80,
            timestamp: new Date().toISOString(),
            source: 'simulated',
          },
        ],
      };

      const res = await agent
        .post('/v1/telemetry')
        .set('X-Ingest-Key', settings.ingest_api_key)
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.error.message).toContain('HMAC signature required');
    });
  });
});
