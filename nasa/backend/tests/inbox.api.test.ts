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
import { FusedAlert } from '../src/models/FusedAlert.js';
import { type EventBus } from '../src/bus/eventBus.js';

describe('Alert Inbox REST API (F097)', () => {
  let agent: ReturnType<typeof createTestApp>['agent'];
  let auditWriter: ReturnType<typeof createTestApp>['auditWriter'];
  let eventBus: EventBus;

  let surgeonToken: string;
  let surgeonUser: Awaited<ReturnType<typeof createTestUser>>['user'];
  let controlToken: string;
  let astro1Token: string;
  let astro1ProfileId: string;
  let _astro2Token: string;
  let astro2ProfileId: string;
  let medOfficerToken: string;
  let sampleAlertId: string;

  beforeAll(async () => {
    await setupTestMongo();
    const testApp = createTestApp();
    agent = testApp.agent;
    auditWriter = testApp.auditWriter;
    eventBus = testApp.eventBus;
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();
    auditWriter.clear();

    // 1. Flight Surgeon
    const surgeon = await createTestUser({ role: 'flight_surgeon', display_name: 'Dr. McCoy' });
    surgeonToken = surgeon.token;
    surgeonUser = surgeon.user;

    // 2. Mission Control
    const control = await createTestUser({ role: 'mission_control', display_name: 'Gene Kranz' });
    controlToken = control.token;

    // 3. Crew 1 Astronaut
    const astro1Profile = await CrewProfile.create({
      callsign: 'Apollo-11',
      age: 38,
      sex: 'male',
      height_cm: 180,
      weight_kg: 75,
      baseline: {},
      is_synthetic: true,
    });
    astro1ProfileId = astro1Profile._id.toString();

    const astro1 = await createTestUser({ role: 'astronaut', display_name: 'Neil Armstrong' });
    await User.findByIdAndUpdate(astro1.user.id, { crew_profile_id: astro1Profile._id });
    astro1Token = astro1.token;

    // 4. Crew 2 Astronaut
    const astro2Profile = await CrewProfile.create({
      callsign: 'Ares-1',
      age: 32,
      sex: 'female',
      height_cm: 165,
      weight_kg: 60,
      baseline: {},
      is_synthetic: true,
    });
    astro2ProfileId = astro2Profile._id.toString();

    const astro2 = await createTestUser({ role: 'astronaut', display_name: 'Mark Watney' });
    await User.findByIdAndUpdate(astro2.user.id, { crew_profile_id: astro2Profile._id });
    _astro2Token = astro2.token;

    // 5. Medical Officer Astronaut
    const medOfficer = await createTestUser({
      role: 'astronaut',
      is_medical_officer: true,
      display_name: 'Dr. Stone',
    });
    await User.findByIdAndUpdate(medOfficer.user.id, { crew_profile_id: astro1Profile._id });
    medOfficerToken = medOfficer.token;

    // Seed sample fused alert for Crew 1
    const sample = await FusedAlert.create({
      crew_id: astro1ProfileId,
      hazard: 'respiratory',
      group_key: `${astro1ProfileId}:respiratory`,
      is_unresolved: true,
      status: 'open',
      condition: 'active',
      severity: 'warning',
      peak_severity: 'warning',
      priority_score: 40,
      priority_key: 3040,
      title: 'Respiratory: SpO2 low (warning)',
      summary: '1 source reporting: rule spo2',
      explanation: 'Oxygen saturation below 90%',
      factors: [],
      confidence: null,
      sources: ['rule'],
      metrics: ['spo2'],
      members: [
        {
          source: 'rule',
          ref_id: 'rule-spo2',
          metric: 'spo2',
          severity: 'warning',
          effective_severity: 'warning',
          status: 'active',
          confidence_capped: false,
          raised_at: '2026-10-18T10:00:00.000Z',
          last_seen_at: '2026-10-18T10:00:00.000Z',
          title: 'SpO2 warning',
          explanation: 'Oxygen saturation below 90%',
        },
      ],
      member_count_total: 1,
      dropped_members: 0,
      mission_mode: 'mars',
      raised_at: '2026-10-18T10:00:00.000Z',
      last_activity_at: '2026-10-18T10:00:00.000Z',
      suppressed_events: 0,
      reopen_count: 0,
      version: 1,
      timeline: [
        {
          at: '2026-10-18T10:00:00.000Z',
          type: 'created',
          actor_id: 'system',
          to_status: 'open',
          severity: 'warning',
        },
      ],
    });
    sampleAlertId = sample._id.toString();
  });

  describe('Role-Based Access Control Matrix', () => {
    it('astronaut sees only own crew and passing another crew_id returns 403 FORBIDDEN', async () => {
      // Access own crew items -> 200
      const ownRes = await agent.get('/v1/inbox').set('Authorization', `Bearer ${astro1Token}`);
      expect(ownRes.status).toBe(200);
      expect(ownRes.body.items).toHaveLength(1);
      expect(ownRes.body.items[0].crew_id).toBe(astro1ProfileId);

      // Accessing other crew explicitly -> 403
      const otherRes = await agent
        .get(`/v1/inbox?crew_id=${astro2ProfileId}`)
        .set('Authorization', `Bearer ${astro1Token}`);
      expect(otherRes.status).toBe(403);
      expect(otherRes.body.error.code).toBe('FORBIDDEN');
    });

    it('mission_control cannot perform medical workflow actions (snooze, assign, resolve, notes) -> 403', async () => {
      const snoozeRes = await agent
        .post(`/v1/inbox/${sampleAlertId}/snooze`)
        .set('Authorization', `Bearer ${controlToken}`)
        .send({ duration_min: 30, reason: 'Trying to snooze' });
      expect(snoozeRes.status).toBe(403);

      const assignRes = await agent
        .post(`/v1/inbox/${sampleAlertId}/assign`)
        .set('Authorization', `Bearer ${controlToken}`)
        .send({ assignee_id: 'me' });
      expect(assignRes.status).toBe(403);

      const resolveRes = await agent
        .post(`/v1/inbox/${sampleAlertId}/resolve`)
        .set('Authorization', `Bearer ${controlToken}`)
        .send({ resolution_note: 'Resolving from mission control' });
      expect(resolveRes.status).toBe(403);

      const noteRes = await agent
        .post(`/v1/inbox/${sampleAlertId}/notes`)
        .set('Authorization', `Bearer ${controlToken}`)
        .send({ text: 'Note from mission control' });
      expect(noteRes.status).toBe(403);
    });

    it('mission_control CAN read and acknowledge alerts', async () => {
      const listRes = await agent.get('/v1/inbox').set('Authorization', `Bearer ${controlToken}`);
      expect(listRes.status).toBe(200);

      const ackRes = await agent
        .post(`/v1/inbox/${sampleAlertId}/acknowledge`)
        .set('Authorization', `Bearer ${controlToken}`)
        .send({});
      expect(ackRes.status).toBe(200);
      expect(ackRes.body.item.status).toBe('acknowledged');
    });

    it('medical-officer astronaut CAN perform medical workflow actions', async () => {
      const assignRes = await agent
        .post(`/v1/inbox/${sampleAlertId}/assign`)
        .set('Authorization', `Bearer ${medOfficerToken}`)
        .send({ assignee_id: 'me' });
      expect(assignRes.status).toBe(200);
      expect(assignRes.body.item.assignee_id).toBeDefined();

      const noteRes = await agent
        .post(`/v1/inbox/${sampleAlertId}/notes`)
        .set('Authorization', `Bearer ${medOfficerToken}`)
        .send({ text: 'Clinical checkup initiated by MO' });
      expect(noteRes.status).toBe(200);
    });
  });

  describe('Keyset Pagination & Keyset Sorting (> 3 pages with ties)', () => {
    it('paginates correctly across 4 pages without skips or duplicates under priority keyset sort', async () => {
      // Clear and seed 10 items with some tied priority_keys
      await FusedAlert.deleteMany({});
      const seededIds: string[] = [];

      for (let i = 0; i < 10; i++) {
        const priorityScore = (i % 3) * 10 + 10; // 10, 20, 30 ties
        const priorityKey = 3000 + priorityScore;
        const doc = await FusedAlert.create({
          crew_id: astro1ProfileId,
          hazard: 'general',
          group_key: `${astro1ProfileId}:item-${i}`,
          is_unresolved: true,
          status: 'open',
          condition: 'active',
          severity: 'watch',
          peak_severity: 'watch',
          priority_score: priorityScore,
          priority_key: priorityKey,
          title: `Alert ${i}`,
          summary: 'summary',
          explanation: 'explanation',
          sources: ['rule'],
          metrics: [],
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
        seededIds.push(doc._id.toString());
      }

      // Page size 3 -> 4 pages: 3, 3, 3, 1
      const collectedIds: string[] = [];

      // Page 1
      const p1 = await agent
        .get('/v1/inbox?limit=3&sort=priority')
        .set('Authorization', `Bearer ${surgeonToken}`);
      expect(p1.status).toBe(200);
      expect(p1.body.items).toHaveLength(3);
      expect(p1.body.has_more).toBe(true);
      expect(p1.body.next_cursor).toBeDefined();
      collectedIds.push(...p1.body.items.map((it: { id: string }) => it.id));

      // Page 2
      const p2 = await agent
        .get(`/v1/inbox?limit=3&sort=priority&cursor=${p1.body.next_cursor}`)
        .set('Authorization', `Bearer ${surgeonToken}`);
      expect(p2.status).toBe(200);
      expect(p2.body.items).toHaveLength(3);
      expect(p2.body.has_more).toBe(true);
      collectedIds.push(...p2.body.items.map((it: { id: string }) => it.id));

      // Page 3
      const p3 = await agent
        .get(`/v1/inbox?limit=3&sort=priority&cursor=${p2.body.next_cursor}`)
        .set('Authorization', `Bearer ${surgeonToken}`);
      expect(p3.status).toBe(200);
      expect(p3.body.items).toHaveLength(3);
      expect(p3.body.has_more).toBe(true);
      collectedIds.push(...p3.body.items.map((it: { id: string }) => it.id));

      // Page 4
      const p4 = await agent
        .get(`/v1/inbox?limit=3&sort=priority&cursor=${p3.body.next_cursor}`)
        .set('Authorization', `Bearer ${surgeonToken}`);
      expect(p4.status).toBe(200);
      expect(p4.body.items).toHaveLength(1);
      expect(p4.body.has_more).toBe(false);
      expect(p4.body.next_cursor).toBeNull();
      collectedIds.push(...p4.body.items.map((it: { id: string }) => it.id));

      // Exactly 10 distinct items received, 0 duplicates, 0 skips
      expect(collectedIds).toHaveLength(10);
      const uniqueCollected = new Set(collectedIds);
      expect(uniqueCollected.size).toBe(10);
    });

    it('rejects invalid pagination cursor with 422 VALIDATION_ERROR', async () => {
      const res = await agent
        .get('/v1/inbox?cursor=not-valid-base64-json!!!')
        .set('Authorization', `Bearer ${surgeonToken}`);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Auditing & Degraded Bus Fallback', () => {
    it('writes audit entry on every workflow action without exposing note text', async () => {
      const res = await agent
        .post(`/v1/inbox/${sampleAlertId}/notes`)
        .set('Authorization', `Bearer ${surgeonToken}`)
        .send({ text: 'Highly sensitive patient medical note' });

      expect(res.status).toBe(200);

      // Verify audit entry
      const entry = auditWriter.entries.find((e) => e.action === 'NOTE_ADDED');
      expect(entry).toBeDefined();
      expect(entry?.actor_id).toBe(surgeonUser.id);
      expect(entry?.target_id).toBe(sampleAlertId);
      // Note text must NOT be present in audit entry, only length!
      expect(entry?.metadata?.['note_length']).toBe('Highly sensitive patient medical note'.length);
      expect(JSON.stringify(entry)).not.toContain('Highly sensitive patient medical note');
    });

    it('with a failing bus, the action still succeeds with event.bus "degraded"', async () => {
      // Mock eventBus.publish to reject
      const origPublish = eventBus.publish;
      eventBus.publish = async () => {
        throw new Error('Redis bus stream disconnected');
      };

      try {
        const res = await agent
          .post(`/v1/inbox/${sampleAlertId}/acknowledge`)
          .set('Authorization', `Bearer ${surgeonToken}`)
          .send({});

        expect(res.status).toBe(200);
        expect(res.body.changed).toBe(true);
        expect(res.body.event.bus).toBe('degraded');
      } finally {
        eventBus.publish = origPublish;
      }
    });
  });

  describe('Summary Endpoint', () => {
    it('returns valid counts and top crews by priority', async () => {
      const res = await agent
        .get('/v1/inbox/summary')
        .set('Authorization', `Bearer ${surgeonToken}`);
      expect(res.status).toBe(200);
      expect(res.body.by_status).toBeDefined();
      expect(res.body.by_status.open).toBeGreaterThanOrEqual(1);
      expect(res.body.by_severity).toBeDefined();
      expect(res.body.top_crews_by_priority).toBeDefined();
    });
  });
});
