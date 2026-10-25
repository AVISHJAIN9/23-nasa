import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

describe('GET /v1/events REST Replay Endpoint (F118)', () => {
  beforeAll(async () => {
    await setupTestMongo();
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();
  });

  async function createCrewAndAstronaut(callsign = 'Astro-One') {
    const profile = await CrewProfile.create({
      callsign,
      age: 32,
      sex: 'male',
      height_cm: 180,
      weight_kg: 80,
      medical_history: [],
      baseline: {},
      baseline_status: 'pending',
      is_synthetic: false,
    });

    const { user, token } = await createTestUser({ role: 'astronaut' });
    await User.findByIdAndUpdate(user._id, { crew_profile_id: profile._id });

    return { user, token, crewId: String(profile._id) };
  }

  it('rejects topic=telemetry query parameter with 422 VALIDATION_ERROR', async () => {
    const { token } = await createTestUser({ role: 'flight_surgeon' });
    const { agent } = createTestApp();

    const res = await agent
      .get('/v1/events?topic=telemetry')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('replays stream events after a given stream ID', async () => {
    const { token } = await createTestUser({ role: 'admin' });
    const eventBus = new MemoryEventBus();

    const p1 = await eventBus.publish({
      topic: 'alerts',
      type: 'alert.raised',
      payload: { id: 1 },
    });
    const p2 = await eventBus.publish({
      topic: 'alerts',
      type: 'alert.raised',
      payload: { id: 2 },
    });
    const p3 = await eventBus.publish({
      topic: 'emergency',
      type: 'emergency.declared',
      payload: { id: 3 },
    });

    const { agent } = createTestApp({ eventBus });

    const res = await agent
      .get(`/v1/events?after=${p1.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].uid).toBe(p2.uid);
    expect(res.body.events[1].uid).toBe(p3.uid);
    expect(res.body.truncated).toBe(false);
    expect(res.body.reset).toBe(false);
    expect(res.body.head_id).toBe(p3.id);
  });

  it('enforces audience authorization and projection during replay', async () => {
    const { token: astro1Token, crewId: crew1Id } = await createCrewAndAstronaut('Astro-1');
    const { crewId: crew2Id } = await createCrewAndAstronaut('Astro-2');
    const { token: mcToken } = await createTestUser({ role: 'mission_control' });

    const eventBus = new MemoryEventBus();

    // Event 1: Alert for crew 1
    const a1 = await eventBus.publish({
      topic: 'alerts',
      type: 'alert.raised',
      crew_id: crew1Id,
      payload: { metric: 'hr', value: 120 },
    });

    // Event 2: Alert for crew 2 (astro1 should NOT see this)
    await eventBus.publish({
      topic: 'alerts',
      type: 'alert.raised',
      crew_id: crew2Id,
      payload: { metric: 'hr', value: 130 },
    });

    // Event 3: Emergency for crew 2 (astro1 SHOULD see this because emergencies reach all crew)
    const e1 = await eventBus.publish({
      topic: 'emergency',
      type: 'emergency.declared',
      crew_id: crew2Id,
      payload: {
        type: 'cardiac',
        note: 'Secret emergency note',
        declared_by: 'some-other-user',
      },
    });

    const { agent } = createTestApp({ eventBus });

    // Astro 1 query
    const astroRes = await agent
      .get('/v1/events?after=0-0')
      .set('Authorization', `Bearer ${astro1Token}`);

    expect(astroRes.status).toBe(200);
    const astroUids = astroRes.body.events.map((e: { uid: string }) => e.uid);
    expect(astroUids).toContain(a1.uid);
    expect(astroUids).toContain(e1.uid);
    expect(astroRes.body.events).toHaveLength(2);

    // Mission Control query: sees all 3, but free-text note on emergency is redacted
    const mcRes = await agent.get('/v1/events?after=0-0').set('Authorization', `Bearer ${mcToken}`);

    expect(mcRes.status).toBe(200);
    expect(mcRes.body.events).toHaveLength(3);
    const mcEmergency = mcRes.body.events.find(
      (e: { type: string }) => e.type === 'emergency.declared',
    );
    expect(mcEmergency.payload.note).toBeUndefined();
  });
});
