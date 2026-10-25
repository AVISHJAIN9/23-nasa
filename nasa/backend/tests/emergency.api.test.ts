import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  setupTestMongo,
  teardownTestMongo,
  clearTestMongo,
  createTestApp,
  createTestUser,
} from './helpers.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { User } from '../src/models/User.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { InMemoryAuditWriter } from '../src/core/audit.js';
import { type Envelope } from '../src/bus/eventTypes.js';

describe('Emergency API Endpoints (F063)', () => {
  beforeAll(async () => {
    await setupTestMongo();
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();
  });

  async function createCrewAndAstronaut(callsign = 'Astro-Alpha') {
    const profile = await CrewProfile.create({
      callsign,
      age: 35,
      sex: 'female',
      height_cm: 172,
      weight_kg: 68,
      medical_history: [],
      baseline: {},
      baseline_status: 'pending',
      is_synthetic: false,
    });

    const { user, token } = await createTestUser({ role: 'astronaut' });
    await User.findByIdAndUpdate(user._id, { crew_profile_id: profile._id });

    return { user, token, crewId: String(profile._id) };
  }

  describe('POST /v1/emergencies (Declaration & Authorization)', () => {
    it('allows astronaut to declare emergency for their own crew (201)', async () => {
      const { user, token, crewId } = await createCrewAndAstronaut();
      const { agent } = createTestApp();

      const clientRequestId = randomUUID();
      const res = await agent.post('/v1/emergencies').set('Authorization', `Bearer ${token}`).send({
        type: 'cardiac',
        note: 'Severe arrhythmia detected',
        source: 'button',
        client_request_id: clientRequestId,
      });

      expect(res.status).toBe(201);
      expect(res.body.emergency).toBeDefined();
      expect(res.body.emergency.type).toBe('cardiac');
      expect(res.body.emergency.crew_id).toBe(crewId);
      expect(res.body.emergency.declared_by).toBe(String(user._id));
      expect(res.body.emergency.status).toBe('active');
      expect(res.body.broadcast).toBeDefined();
      expect(res.body.broadcast.bus).toBe('ok');
    });

    it('rejects astronaut declaring for another crew with 403', async () => {
      const { token } = await createCrewAndAstronaut('Astro-1');
      const otherProfile = await CrewProfile.create({
        callsign: 'Astro-2',
        age: 40,
        sex: 'male',
        height_cm: 180,
        weight_kg: 75,
        medical_history: [],
        baseline: {},
        baseline_status: 'pending',
        is_synthetic: false,
      });

      const { agent } = createTestApp();
      const res = await agent
        .post('/v1/emergencies')
        .set('Authorization', `Bearer ${token}`)
        .send({
          crew_id: String(otherProfile._id),
          type: 'breathing',
          client_request_id: randomUUID(),
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('forbids mission_control and flight_surgeon from declaring an emergency (403)', async () => {
      const { token: mcToken } = await createTestUser({ role: 'mission_control' });
      const { token: surgToken } = await createTestUser({ role: 'flight_surgeon' });
      const { agent } = createTestApp();

      for (const t of [mcToken, surgToken]) {
        const res = await agent.post('/v1/emergencies').set('Authorization', `Bearer ${t}`).send({
          type: 'cardiac',
          client_request_id: randomUUID(),
        });
        expect(res.status).toBe(403);
      }
    });

    it('returns 401 UNAUTHENTICATED without a token', async () => {
      const { agent } = createTestApp();
      const res = await agent.post('/v1/emergencies').send({
        type: 'cardiac',
        client_request_id: randomUUID(),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Idempotency and Deduplication Rules', () => {
    it('returns 200 with the same emergency on repeated client_request_id by the same user', async () => {
      const { token } = await createCrewAndAstronaut();
      const eventBus = new MemoryEventBus();
      const eventsEmitted: Envelope[] = [];
      eventBus.subscribe((e) => eventsEmitted.push(e));

      const { agent } = createTestApp({ eventBus });
      const clientReqId = randomUUID();

      const res1 = await agent
        .post('/v1/emergencies')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'cardiac',
          note: 'First tap',
          client_request_id: clientReqId,
        });
      expect(res1.status).toBe(201);
      expect(eventsEmitted).toHaveLength(1);

      // Repeat with same client_request_id
      const res2 = await agent
        .post('/v1/emergencies')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'cardiac',
          note: 'Second tap retry',
          client_request_id: clientReqId,
        });

      expect(res2.status).toBe(200);
      expect(res2.body.emergency.id).toBe(res1.body.emergency.id);
      // No new event published to bus
      expect(eventsEmitted).toHaveLength(1);
    });

    it('returns 200 with deduplicated: true for different client_request_id within dedupe window', async () => {
      const { token } = await createCrewAndAstronaut();
      const eventBus = new MemoryEventBus();
      const eventsEmitted: Envelope[] = [];
      eventBus.subscribe((e) => eventsEmitted.push(e));

      const { agent } = createTestApp({
        eventBus,
        customSettings: { emergency_dedupe_s: 30 },
      });

      const res1 = await agent
        .post('/v1/emergencies')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'cardiac',
          client_request_id: randomUUID(),
        });
      expect(res1.status).toBe(201);
      expect(eventsEmitted).toHaveLength(1);

      // Different client_request_id inside dedupe window
      const res2 = await agent
        .post('/v1/emergencies')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'cardiac',
          client_request_id: randomUUID(),
        });

      expect(res2.status).toBe(200);
      expect(res2.body.deduplicated).toBe(true);
      expect(res2.body.emergency.id).toBe(res1.body.emergency.id);
      // No second event published to bus
      expect(eventsEmitted).toHaveLength(1);
    });
  });

  describe('Order of Operations and Failure Handling', () => {
    it('succeeds with broadcast.bus "degraded" if the event bus fails', async () => {
      const { token } = await createCrewAndAstronaut();
      const failingBus = new MemoryEventBus();
      // Close bus so it returns degraded
      await failingBus.close();

      const { agent } = createTestApp({ eventBus: failingBus });
      const res = await agent.post('/v1/emergencies').set('Authorization', `Bearer ${token}`).send({
        type: 'trauma_injury',
        client_request_id: randomUUID(),
      });

      expect(res.status).toBe(201);
      expect(res.body.emergency).toBeDefined();
      expect(res.body.broadcast.bus).toBe('degraded');
    });

    it('aborts without publishing event if audit writer fails', async () => {
      const { token } = await createCrewAndAstronaut();
      const eventBus = new MemoryEventBus();
      const eventsEmitted: Envelope[] = [];
      eventBus.subscribe((e) => eventsEmitted.push(e));

      const failingAuditWriter = {
        async write() {
          throw new Error('Audit storage failure');
        },
      };

      const { agent } = createTestApp({
        eventBus,
        auditWriter: failingAuditWriter as unknown as InMemoryAuditWriter,
      });

      const res = await agent.post('/v1/emergencies').set('Authorization', `Bearer ${token}`).send({
        type: 'cardiac',
        client_request_id: randomUUID(),
      });

      expect(res.status).toBe(500);
      // No event published to bus!
      expect(eventsEmitted).toHaveLength(0);
    });
  });

  describe('Lifecycle: Acknowledge, Resolve, Cancel', () => {
    it('acknowledges an active emergency and records acknowledging user', async () => {
      const { token: astroToken } = await createCrewAndAstronaut();
      const { token: mcToken, user: mcUser } = await createTestUser({ role: 'mission_control' });
      const { agent } = createTestApp();

      const decRes = await agent
        .post('/v1/emergencies')
        .set('Authorization', `Bearer ${astroToken}`)
        .send({
          type: 'cardiac',
          client_request_id: randomUUID(),
        });

      const emergencyId = decRes.body.emergency.id;

      const ackRes = await agent
        .post(`/v1/emergencies/${emergencyId}/acknowledge`)
        .set('Authorization', `Bearer ${mcToken}`);

      expect(ackRes.status).toBe(200);
      expect(ackRes.body.emergency.status).toBe('acknowledged');
      expect(ackRes.body.emergency.acknowledged_by).toHaveLength(1);
      expect(ackRes.body.emergency.acknowledged_by[0].user_id).toBe(String(mcUser._id));
    });

    it('resolves an emergency with resolution note (surgeon or admin only)', async () => {
      const { token: astroToken } = await createCrewAndAstronaut();
      const { token: surgToken } = await createTestUser({ role: 'flight_surgeon' });
      const { agent } = createTestApp();

      const decRes = await agent
        .post('/v1/emergencies')
        .set('Authorization', `Bearer ${astroToken}`)
        .send({
          type: 'burn',
          client_request_id: randomUUID(),
        });
      const emergencyId = decRes.body.emergency.id;

      // Astronaut cannot resolve (403)
      const badRes = await agent
        .post(`/v1/emergencies/${emergencyId}/resolve`)
        .set('Authorization', `Bearer ${astroToken}`)
        .send({ resolution_note: 'Done' });
      expect(badRes.status).toBe(403);

      // Surgeon can resolve
      const goodRes = await agent
        .post(`/v1/emergencies/${emergencyId}/resolve`)
        .set('Authorization', `Bearer ${surgToken}`)
        .send({ resolution_note: 'Topical dressing applied' });

      expect(goodRes.status).toBe(200);
      expect(goodRes.body.emergency.status).toBe('resolved');
      expect(goodRes.body.emergency.resolution_note).toBe('Topical dressing applied');
    });

    it('cancels within window (declaring astronaut), but fails outside window with 409 CONFLICT', async () => {
      const { token: astroToken } = await createCrewAndAstronaut();
      const { agent } = createTestApp({
        customSettings: { emergency_cancel_window_s: 1 },
      });

      const decRes = await agent
        .post('/v1/emergencies')
        .set('Authorization', `Bearer ${astroToken}`)
        .send({
          type: 'other',
          client_request_id: randomUUID(),
        });
      const emergencyId = decRes.body.emergency.id;

      // Wait 1.1s for cancel window to expire
      await new Promise((r) => setTimeout(r, 1100));

      const cancelRes = await agent
        .post(`/v1/emergencies/${emergencyId}/cancel`)
        .set('Authorization', `Bearer ${astroToken}`);

      expect(cancelRes.status).toBe(409);
      expect(cancelRes.body.error.code).toBe('CONFLICT');
    });
  });

  describe('Listing and Role Projection', () => {
    it('redacts free-text notes for mission_control in list and get', async () => {
      const { token: astroToken } = await createCrewAndAstronaut();
      const { token: mcToken } = await createTestUser({ role: 'mission_control' });
      const { agent } = createTestApp();

      const decRes = await agent
        .post('/v1/emergencies')
        .set('Authorization', `Bearer ${astroToken}`)
        .send({
          type: 'cardiac',
          note: 'Top secret medical distress note',
          client_request_id: randomUUID(),
        });
      const emergencyId = decRes.body.emergency.id;

      // Mission control GET /v1/emergencies/:id
      const getRes = await agent
        .get(`/v1/emergencies/${emergencyId}`)
        .set('Authorization', `Bearer ${mcToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.emergency.note).toBeUndefined();

      // Mission control GET /v1/emergencies list
      const listRes = await agent.get('/v1/emergencies').set('Authorization', `Bearer ${mcToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.items).toHaveLength(1);
      expect(listRes.body.items[0].note).toBeUndefined();
    });
  });
});
