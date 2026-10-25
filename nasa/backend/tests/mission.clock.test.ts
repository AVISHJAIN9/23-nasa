import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestMongo,
  teardownTestMongo,
  clearTestMongo,
  createTestApp,
  createTestUser,
} from './helpers.js';
import { FakeClock } from '../src/core/clock.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import {
  missionNowMs,
  missionDay,
  wallAtMissionMs,
  MissionClockService,
  type MissionClockState,
} from '../src/mission/missionClock.js';
import { MissionClock } from '../src/models/MissionClock.js';
import { parseConfig, type Settings } from '../src/core/config.js';
import { Envelope } from '../src/bus/eventTypes.js';
import { type AuditEntry } from '../src/core/audit.js';

describe('Mission Clock (Part 2e / F070)', () => {
  describe('Pure Functions', () => {
    const baseState: MissionClockState = {
      mission_start_at: 1000000000,
      anchor_wall_at: 1000000000,
      anchor_mission_at: 1000000000,
      time_scale: 1,
      updated_by: 'system',
      updated_at: 1000000000,
      version: 1,
    };

    it('missionNowMs returns 1:1 progression under scale 1', () => {
      expect(missionNowMs(baseState, 1000000000)).toBe(1000000000);
      expect(missionNowMs(baseState, 1000001000)).toBe(1000001000);
    });

    it('missionNowMs scales delta correctly under scale 60 (1s wall = 1m mission)', () => {
      const fastState: MissionClockState = { ...baseState, time_scale: 60 };
      expect(missionNowMs(fastState, 1000000000)).toBe(1000000000);
      expect(missionNowMs(fastState, 1000001000)).toBe(1000060000); // 1s wall -> 60s mission
    });

    it('missionDay correctly computes 1-indexed days and day boundaries', () => {
      const startMs = 1700000000000;
      const state = { mission_start_at: startMs };

      expect(missionDay(state, startMs)).toBe(1);
      expect(missionDay(state, startMs + 86399999)).toBe(1);
      expect(missionDay(state, startMs + 86400000)).toBe(2);
      expect(missionDay(state, startMs + 86400000 * 30)).toBe(31);
    });

    it('re-anchoring keeps mission time continuous when scale changes', () => {
      const wall0 = 1000000;
      let state: MissionClockState = {
        mission_start_at: wall0,
        anchor_wall_at: wall0,
        anchor_mission_at: wall0,
        time_scale: 1,
        updated_by: 'system',
        updated_at: wall0,
        version: 1,
      };

      // Progress 10s at scale 1
      const wall1 = wall0 + 10000;
      const missionAtWall1 = missionNowMs(state, wall1);
      expect(missionAtWall1).toBe(wall0 + 10000);

      // Re-anchor at wall1 with scale 360
      state = {
        ...state,
        anchor_wall_at: wall1,
        anchor_mission_at: missionAtWall1,
        time_scale: 360,
      };

      // At exact moment of change (wall1), mission time is strictly continuous
      expect(missionNowMs(state, wall1)).toBe(missionAtWall1);

      // Progress 1s wall time at scale 360
      const wall2 = wall1 + 1000;
      expect(missionNowMs(state, wall2)).toBe(missionAtWall1 + 360000);
    });

    it('wallAtMissionMs acts as exact future inverse using current scale', () => {
      const state: MissionClockState = {
        mission_start_at: 1000000,
        anchor_wall_at: 2000000,
        anchor_mission_at: 5000000,
        time_scale: 10,
        updated_by: 'system',
        updated_at: 2000000,
        version: 1,
      };

      const futureMissionMs = 5000000 + 100000; // 100s in mission time
      const expectedWallMs = 2000000 + 10000; // 10s in wall time
      expect(wallAtMissionMs(state, futureMissionMs)).toBe(expectedWallMs);
    });
  });

  describe('Service & MongoDB Persistence', () => {
    beforeAll(async () => {
      await setupTestMongo();
    });

    afterAll(async () => {
      await teardownTestMongo();
    });

    beforeEach(async () => {
      await clearTestMongo();
    });

    it('initializes from default settings on first boot and persists document', async () => {
      const fakeClock = new FakeClock(1700000000000);
      const settings = parseConfig({
        ASTRO_MISSION_INITIAL_DAY: 31,
        ASTRO_MISSION_TIME_SCALE: 1,
      });
      const eventBus = new MemoryEventBus();
      const auditWriter = { write: async () => {} };

      const service = new MissionClockService({
        clock: fakeClock,
        settings,
        eventBus,
        auditWriter,
      });

      await service.init();
      service.stop();

      const doc = await MissionClock.findOne();
      expect(doc).toBeDefined();
      expect(doc?.time_scale).toBe(1);
      expect(service.day()).toBe(31);

      // Re-booting a second instance reuses the persisted document
      const service2 = new MissionClockService({
        clock: fakeClock,
        settings: parseConfig({ ASTRO_MISSION_INITIAL_DAY: 10 }), // Setting should NOT override persisted
        eventBus,
        auditWriter,
      });

      await service2.init();
      service2.stop();

      expect(service2.day()).toBe(31); // Still 31 from DB
    });

    it('setTimeScale updates Mongo, audits change, and publishes system.notice event', async () => {
      const fakeClock = new FakeClock(1700000000000);
      const settings = parseConfig({ ASTRO_MISSION_INITIAL_DAY: 1 });
      const eventBus = new MemoryEventBus();
      const publishedEvents: Envelope[] = [];
      eventBus.subscribe(
        (env) => {
          publishedEvents.push(env);
        },
        { topics: ['system'] },
      );

      const auditEntries: AuditEntry[] = [];
      const auditWriter = {
        write: async (entry: AuditEntry) => {
          auditEntries.push(entry);
        },
      };

      const service = new MissionClockService({
        clock: fakeClock,
        settings,
        eventBus,
        auditWriter,
      });

      await service.init();

      // Change scale to 10
      const updated = await service.setTimeScale(10, 'admin-poole', 'req-clock-1');

      expect(updated.time_scale).toBe(10);
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]!.action).toBe('MISSION_CLOCK_SCALE_CHANGED');
      expect(auditEntries[0]!.metadata!['new_scale']).toBe(10);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]!.type).toBe('system.notice');
      expect(publishedEvents[0]!.payload['kind']).toBe('mission.clock_changed');
      expect(publishedEvents[0]!.payload['time_scale']).toBe(10);

      service.stop();
    });
  });

  describe('REST Endpoints (/v1/mission/clock)', () => {
    let agent: ReturnType<typeof createTestApp>['agent'];
    let adminToken: string;
    let astroToken: string;
    let settings: Settings;

    beforeAll(async () => {
      await setupTestMongo();
    });

    afterAll(async () => {
      await teardownTestMongo();
    });

    beforeEach(async () => {
      await clearTestMongo();

      const testApp = createTestApp({
        initialFlags: { demo_panel_enabled: true },
      });
      agent = testApp.agent;
      settings = testApp.settings;

      const admin = await createTestUser({ role: 'admin' });
      adminToken = admin.token;

      const astro = await createTestUser({ role: 'astronaut' });
      astroToken = astro.token;
    });

    it('GET /v1/mission/clock returns 200 with JWT for any role', async () => {
      const res = await agent.get('/v1/mission/clock').set('Authorization', `Bearer ${astroToken}`);

      expect(res.status).toBe(200);
      expect(res.body.mission_now).toBeDefined();
      expect(res.body.mission_day).toBeDefined();
      expect(res.body.time_scale).toBeDefined();
      expect(res.body.wall_now).toBeDefined();
    });

    it('GET /v1/mission/clock accepts X-Ingest-Key without JWT for Python simulator sync', async () => {
      const res = await agent.get('/v1/mission/clock').set('X-Ingest-Key', settings.ingest_api_key);

      expect(res.status).toBe(200);
      expect(res.body.time_scale).toBe(1);
    });

    it('GET /v1/mission/clock rejects invalid X-Ingest-Key and missing auth with 401', async () => {
      const res1 = await agent.get('/v1/mission/clock');
      expect(res1.status).toBe(401);

      const res2 = await agent
        .get('/v1/mission/clock')
        .set('X-Ingest-Key', 'wrong_ingest_key_that_does_not_match!');
      expect(res2.status).toBe(401);
    });

    it('PUT /v1/mission/clock succeeds for admin with demo_panel_enabled', async () => {
      const res = await agent
        .put('/v1/mission/clock')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ time_scale: 120 });

      expect(res.status).toBe(200);
      expect(res.body.time_scale).toBe(120);

      // Verify GET returns the new scale
      const getRes = await agent
        .get('/v1/mission/clock')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getRes.body.time_scale).toBe(120);
    });

    it('PUT /v1/mission/clock rejects non-admin with 403 FORBIDDEN', async () => {
      const res = await agent
        .put('/v1/mission/clock')
        .set('Authorization', `Bearer ${astroToken}`)
        .send({ time_scale: 60 });

      expect(res.status).toBe(403);
    });

    it('PUT /v1/mission/clock returns 404 NOT_FOUND when demo_panel_enabled is disabled', async () => {
      const disabledApp = createTestApp({
        initialFlags: { demo_panel_enabled: false },
      });

      const res = await disabledApp.agent
        .put('/v1/mission/clock')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ time_scale: 60 });

      expect(res.status).toBe(404);
    });

    it('PUT /v1/mission/clock validates time_scale range (0.1 to 3600)', async () => {
      const resLow = await agent
        .put('/v1/mission/clock')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ time_scale: 0.05 });
      expect(resLow.status).toBe(422);

      const resHigh = await agent
        .put('/v1/mission/clock')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ time_scale: 5000 });
      expect(resHigh.status).toBe(422);
    });
  });
});
