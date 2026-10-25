import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestMongo,
  teardownTestMongo,
  clearTestMongo,
  createTestApp,
  createTestUser,
} from './helpers.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { FusedAlert } from '../src/models/FusedAlert.js';

describe('Inbox Role-Based Projection (F097)', () => {
  let agent: ReturnType<typeof createTestApp>['agent'];
  let crewProfileId: string;
  let surgeonToken: string;
  let mcToken: string;
  let astroToken: string;
  let medAstroToken: string;
  let alertId: string;

  beforeAll(async () => {
    await setupTestMongo();
    const testApp = createTestApp();
    agent = testApp.agent;
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();

    const profile = await CrewProfile.create({
      callsign: 'Ares-1',
      age: 38,
      sex: 'female',
      height_cm: 172,
      weight_kg: 68,
      baseline: {},
      is_synthetic: true,
    });
    crewProfileId = profile._id.toString();

    const surgeon = await createTestUser({ role: 'flight_surgeon', display_name: 'Dr. McCoy' });
    surgeonToken = surgeon.token;

    const mc = await createTestUser({ role: 'mission_control', display_name: 'Flight Lead' });
    mcToken = mc.token;

    const astro = await createTestUser({
      role: 'astronaut',
      display_name: 'Commander Lewis',
      crew_profile_id: crewProfileId,
    });
    astroToken = astro.token;

    const medAstro = await createTestUser({
      role: 'astronaut',
      display_name: 'Dr. Aris (CMO)',
      crew_profile_id: crewProfileId,
      is_medical_officer: true,
    });
    medAstroToken = medAstro.token;

    // Create a fused alert with clinical notes, snooze reason, resolution note
    const alert = await FusedAlert.create({
      crew_id: crewProfileId,
      hazard: 'cardiovascular',
      group_key: `${crewProfileId}:cardiovascular`,
      is_unresolved: false,
      status: 'resolved',
      condition: 'cleared',
      severity: 'warning',
      peak_severity: 'warning',
      priority_score: 50,
      priority_key: 3050,
      title: 'Cardio Anomaly',
      summary: '1 source reporting',
      explanation: 'Sustained arrhythmia',
      sources: ['rule'],
      metrics: ['heart_rate'],
      members: [],
      member_count_total: 1,
      dropped_members: 0,
      mission_mode: 'mars',
      raised_at: '2026-10-18T10:00:00.000Z',
      last_activity_at: '2026-10-18T10:30:00.000Z',
      snoozed_until: '2026-10-18T10:20:00.000Z',
      snoozed_by: surgeon.user.id,
      snooze_reason: 'Wait for second ECG lead calibration',
      resolved_at: '2026-10-18T10:30:00.000Z',
      resolved_by: surgeon.user.id,
      resolution: 'manual',
      resolution_note: 'Sinus rhythm restored after Valsalva maneuver',
      timeline: [
        {
          at: '2026-10-18T10:00:00.000Z',
          type: 'created',
          actor_id: 'system',
          from_status: 'open',
          to_status: 'open',
          note: 'Telemetry triggered rule',
        },
        {
          at: '2026-10-18T10:10:00.000Z',
          type: 'snoozed',
          actor_id: surgeon.user.id,
          actor_role: 'flight_surgeon',
          from_status: 'open',
          to_status: 'snoozed',
          note: 'Evaluating lead 2',
        },
        {
          at: '2026-10-18T10:30:00.000Z',
          type: 'resolved',
          actor_id: surgeon.user.id,
          actor_role: 'flight_surgeon',
          from_status: 'snoozed',
          to_status: 'resolved',
          note: 'Sinus rhythm restored after Valsalva maneuver',
        },
      ],
      version: 3,
    });
    alertId = alert._id.toString();
  });

  it('flight_surgeon receives full details including clinical notes, snooze reason, and resolution note', async () => {
    const res = await agent
      .get(`/v1/inbox/${alertId}`)
      .set('Authorization', `Bearer ${surgeonToken}`);

    expect(res.status).toBe(200);
    expect(res.body.snooze_reason).toBe('Wait for second ECG lead calibration');
    expect(res.body.resolution_note).toBe('Sinus rhythm restored after Valsalva maneuver');
    expect(res.body.timeline[1].note).toBe('Evaluating lead 2');
    expect(res.body.timeline[2].note).toBe('Sinus rhythm restored after Valsalva maneuver');
  });

  it('medical officer astronaut receives full clinical details for own crew', async () => {
    const res = await agent
      .get(`/v1/inbox/${alertId}`)
      .set('Authorization', `Bearer ${medAstroToken}`);

    expect(res.status).toBe(200);
    expect(res.body.snooze_reason).toBe('Wait for second ECG lead calibration');
    expect(res.body.resolution_note).toBe('Sinus rhythm restored after Valsalva maneuver');
    expect(res.body.timeline[1].note).toBe('Evaluating lead 2');
  });

  it('mission_control has snooze_reason, resolution_note, and timeline notes redacted', async () => {
    const res = await agent.get(`/v1/inbox/${alertId}`).set('Authorization', `Bearer ${mcToken}`);

    expect(res.status).toBe(200);
    expect(res.body.snooze_reason).toBeUndefined();
    expect(res.body.resolution_note).toBeUndefined();
    expect(res.body.timeline[0].note).toBeUndefined();
    expect(res.body.timeline[1].note).toBeUndefined();
    expect(res.body.timeline[2].note).toBeUndefined();
  });

  it('ordinary astronaut (non-medical) has clinical notes redacted', async () => {
    const res = await agent
      .get(`/v1/inbox/${alertId}`)
      .set('Authorization', `Bearer ${astroToken}`);

    expect(res.status).toBe(200);
    expect(res.body.snooze_reason).toBeUndefined();
    expect(res.body.resolution_note).toBeUndefined();
    expect(res.body.timeline[1].note).toBeUndefined();
  });

  it('redacts clinical notes in GET /v1/inbox list endpoint for non-medical viewers', async () => {
    const res = await agent
      .get('/v1/inbox?status=resolved')
      .set('Authorization', `Bearer ${mcToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.snooze_reason).toBeUndefined();
    expect(item.resolution_note).toBeUndefined();
  });
});
