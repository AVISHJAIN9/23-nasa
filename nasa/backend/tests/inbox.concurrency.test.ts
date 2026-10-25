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

describe('Inbox Concurrency & Versioning (F097)', () => {
  let agent: ReturnType<typeof createTestApp>['agent'];
  let crewProfileId: string;
  let user1Token: string;
  let user1Id: string;
  let user2Token: string;
  let user2Id: string;

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
      callsign: 'Discovery-1',
      age: 40,
      sex: 'male',
      height_cm: 180,
      weight_kg: 80,
      baseline: {},
      is_synthetic: true,
    });
    crewProfileId = profile._id.toString();

    const u1 = await createTestUser({ role: 'flight_surgeon', display_name: 'Dr. Bowman' });
    user1Token = u1.token;
    user1Id = u1.user.id;

    const u2 = await createTestUser({ role: 'admin', display_name: 'Admin Poole' });
    user2Token = u2.token;
    user2Id = u2.user.id;
  });

  it('two simultaneous acknowledges from different users both succeed, both appear in acknowledged_by, with exactly one status transition', async () => {
    const alert = await FusedAlert.create({
      crew_id: crewProfileId,
      hazard: 'thermal',
      group_key: `${crewProfileId}:thermal`,
      is_unresolved: true,
      status: 'open',
      condition: 'active',
      severity: 'warning',
      peak_severity: 'warning',
      priority_score: 40,
      priority_key: 3040,
      title: 'Thermal Warning',
      summary: '1 source reporting',
      explanation: 'High core temp',
      sources: ['rule'],
      metrics: ['temp_c'],
      members: [],
      member_count_total: 1,
      dropped_members: 0,
      mission_mode: 'mars',
      raised_at: '2026-10-18T10:00:00.000Z',
      last_activity_at: '2026-10-18T10:00:00.000Z',
      suppressed_events: 0,
      reopen_count: 0,
      version: 1,
      timeline: [],
    });

    const alertId = alert._id.toString();

    // Fire two acknowledges simultaneously
    const [res1, res2] = await Promise.all([
      agent
        .post(`/v1/inbox/${alertId}/acknowledge`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({}),
      agent
        .post(`/v1/inbox/${alertId}/acknowledge`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({}),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const updated = await FusedAlert.findById(alertId);
    expect(updated?.status).toBe('acknowledged');
    expect(updated?.acknowledged_by).toHaveLength(2);

    const userIds = updated?.acknowledged_by?.map((a) => a.user_id);
    expect(userIds).toContain(user1Id);
    expect(userIds).toContain(user2Id);
  });

  it('rejects an action with a stale expected_version with 409 CONFLICT', async () => {
    const alert = await FusedAlert.create({
      crew_id: crewProfileId,
      hazard: 'cardiovascular',
      group_key: `${crewProfileId}:cardiovascular`,
      is_unresolved: true,
      status: 'open',
      condition: 'active',
      severity: 'warning',
      peak_severity: 'warning',
      priority_score: 40,
      priority_key: 3040,
      title: 'Cardio Warning',
      summary: '1 source reporting',
      explanation: 'Tachycardia',
      sources: ['rule'],
      metrics: ['heart_rate'],
      members: [],
      member_count_total: 1,
      dropped_members: 0,
      mission_mode: 'mars',
      raised_at: '2026-10-18T10:00:00.000Z',
      last_activity_at: '2026-10-18T10:00:00.000Z',
      suppressed_events: 0,
      reopen_count: 0,
      version: 5, // current version is 5
      timeline: [],
    });

    const alertId = alert._id.toString();

    // Caller passes expected_version: 4 (stale)
    const res = await agent
      .post(`/v1/inbox/${alertId}/acknowledge`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ expected_version: 4 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details.current_version).toBe(5);
    expect(res.body.error.details.expected_version).toBe(4);
    expect(res.body.error.details.current_status).toBe('open');
  });
});
