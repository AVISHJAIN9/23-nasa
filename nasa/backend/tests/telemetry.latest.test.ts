import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { User } from '../src/models/User.js';
import { Reading, ensureReadingsCollection } from '../src/models/Reading.js';
import { signAccessToken } from '../src/core/tokens.js';
import { setupTestMongo, teardownTestMongo, clearTestMongo } from './helpers.js';

describe('Latest Telemetry Endpoint (GET /v1/crew/:id/telemetry/latest)', () => {
  const secret = 'valid_test_access_secret_32_characters_long!';
  const config = parseConfig({
    ASTRO_JWT_ACCESS_SECRET: secret,
  });

  const app = createApp(config);

  let crew1Id: string;
  let crew2Id: string;
  let astronaut1Token: string;
  let surgeonToken: string;
  let missionControlToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await setupTestMongo();
    if (mongoose.connection.db) {
      try {
        await mongoose.connection.db.dropCollection('readings');
      } catch {
        // ignore
      }
    }
    await ensureReadingsCollection(0);
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();

    const crew1 = await CrewProfile.create({
      callsign: 'APOLLO-1',
      age: 40,
      sex: 'male',
      height_cm: 180,
      weight_kg: 80,
      medical_history: [],
      baseline: {},
      baseline_status: 'pending',
      is_synthetic: true,
    });
    crew1Id = crew1._id.toString();

    const crew2 = await CrewProfile.create({
      callsign: 'APOLLO-2',
      age: 36,
      sex: 'female',
      height_cm: 165,
      weight_kg: 58,
      medical_history: [],
      baseline: {},
      baseline_status: 'pending',
      is_synthetic: true,
    });
    crew2Id = crew2._id.toString();

    const astronaut1 = await User.create({
      email: 'apollo1@mars.nasa.gov',
      password_hash: 'hashed',
      display_name: 'Astronaut One',
      role: 'astronaut',
      crew_profile_id: crew1._id,
    });
    astronaut1Token = signAccessToken(
      { userId: astronaut1._id.toString(), role: 'astronaut', isMedicalOfficer: false },
      secret,
    );

    const surgeon = await User.create({
      email: 'surgeon@mars.nasa.gov',
      password_hash: 'hashed',
      display_name: 'Flight Surgeon',
      role: 'flight_surgeon',
    });
    surgeonToken = signAccessToken(
      { userId: surgeon._id.toString(), role: 'flight_surgeon', isMedicalOfficer: false },
      secret,
    );

    const mc = await User.create({
      email: 'mc@mars.nasa.gov',
      password_hash: 'hashed',
      display_name: 'CAPCOM',
      role: 'mission_control',
    });
    missionControlToken = signAccessToken(
      { userId: mc._id.toString(), role: 'mission_control', isMedicalOfficer: false },
      secret,
    );

    const admin = await User.create({
      email: 'admin@mars.nasa.gov',
      password_hash: 'hashed',
      display_name: 'Ground Admin',
      role: 'admin',
    });
    adminToken = signAccessToken(
      { userId: admin._id.toString(), role: 'admin', isMedicalOfficer: false },
      secret,
    );
  });

  it('allows astronaut to view their own crew latest telemetry', async () => {
    const res = await request(app)
      .get(`/v1/crew/${crew1Id}/telemetry/latest`)
      .set('Authorization', `Bearer ${astronaut1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.crew_id).toBe(crew1Id);
    expect(res.body.metrics).toBeDefined();
  });

  it('rejects astronaut attempting to view another crew latest telemetry with 403 FORBIDDEN', async () => {
    const res = await request(app)
      .get(`/v1/crew/${crew2Id}/telemetry/latest`)
      .set('Authorization', `Bearer ${astronaut1Token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows flight_surgeon, mission_control, and admin to view any crew telemetry', async () => {
    const resSurgeon = await request(app)
      .get(`/v1/crew/${crew1Id}/telemetry/latest`)
      .set('Authorization', `Bearer ${surgeonToken}`);
    expect(resSurgeon.status).toBe(200);

    const resMC = await request(app)
      .get(`/v1/crew/${crew1Id}/telemetry/latest`)
      .set('Authorization', `Bearer ${missionControlToken}`);
    expect(resMC.status).toBe(200);

    const resAdmin = await request(app)
      .get(`/v1/crew/${crew1Id}/telemetry/latest`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resAdmin.status).toBe(200);
  });

  it('returns 404 NOT_FOUND for non-existent crew profile', async () => {
    const nonExistentId = new Types.ObjectId().toString();
    const res = await request(app)
      .get(`/v1/crew/${nonExistentId}/telemetry/latest`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns the most recent reading per metric AND the most recent ok reading', async () => {
    const crewObjectId = new Types.ObjectId(crew1Id);

    // Seed heart_rate:
    // t=1: value 70, flag: "ok"
    // t=2: value 72, flag: "ok" (this is latest_ok)
    // t=3: value null, flag: "dropout" (this is overall latest)
    await Reading.insertMany([
      {
        timestamp: new Date('2026-10-18T12:00:01.000Z'),
        meta: { crew_id: crewObjectId, metric: 'heart_rate', source: 'simulated' },
        value: 70,
        unit: 'bpm',
        quality: { flag: 'ok', reasons: [] },
        ingested_at: new Date(),
      },
      {
        timestamp: new Date('2026-10-18T12:00:02.000Z'),
        meta: { crew_id: crewObjectId, metric: 'heart_rate', source: 'simulated' },
        value: 72,
        unit: 'bpm',
        quality: { flag: 'ok', reasons: [] },
        ingested_at: new Date(),
      },
      {
        timestamp: new Date('2026-10-18T12:00:03.000Z'),
        meta: { crew_id: crewObjectId, metric: 'heart_rate', source: 'simulated' },
        value: null,
        unit: 'bpm',
        quality: { flag: 'dropout', reasons: ['dropout'] },
        ingested_at: new Date(),
      },
      // Seed spo2: only ok readings
      {
        timestamp: new Date('2026-10-18T12:00:02.000Z'),
        meta: { crew_id: crewObjectId, metric: 'spo2', source: 'simulated' },
        value: 99,
        unit: '%',
        quality: { flag: 'ok', reasons: [] },
        ingested_at: new Date(),
      },
    ]);

    const res = await request(app)
      .get(`/v1/crew/${crew1Id}/telemetry/latest`)
      .set('Authorization', `Bearer ${surgeonToken}`);

    expect(res.status).toBe(200);

    const hr = res.body.metrics.heart_rate;
    expect(hr).toBeDefined();
    // Latest reading is dropout at t=3
    expect(hr.latest.value).toBeNull();
    expect(hr.latest.quality.flag).toBe('dropout');
    expect(hr.latest.timestamp).toBe('2026-10-18T12:00:03.000Z');

    // Latest ok reading is at t=2 with value 72
    expect(hr.latest_ok.value).toBe(72);
    expect(hr.latest_ok.quality.flag).toBe('ok');
    expect(hr.latest_ok.timestamp).toBe('2026-10-18T12:00:02.000Z');

    // SpO2 reading
    const spo2 = res.body.metrics.spo2;
    expect(spo2.latest.value).toBe(99);
    expect(spo2.latest_ok.value).toBe(99);

    // Unrecorded metric returns null for both
    const temp = res.body.metrics.temp_c;
    expect(temp.latest).toBeNull();
    expect(temp.latest_ok).toBeNull();
  });

  it('utilizes the time-series compound index for latest query execution', async () => {
    const crewObjectId = new Types.ObjectId(crew1Id);

    // Seed 1 reading so explain returns realistic plan
    await Reading.create({
      timestamp: new Date('2026-10-18T12:00:00.000Z'),
      meta: { crew_id: crewObjectId, metric: 'heart_rate', source: 'simulated' },
      value: 70,
      unit: 'bpm',
      quality: { flag: 'ok', reasons: [] },
      ingested_at: new Date(),
    });

    const explainResult = await Reading.findOne({
      'meta.crew_id': crewObjectId,
      'meta.metric': 'heart_rate',
    })
      .sort({ timestamp: -1 })
      .explain('executionStats');

    // Verify query plan does NOT perform an unindexed collection scan
    const stage = JSON.stringify(explainResult);
    expect(stage).not.toContain('"stage":"COLLSCAN"');
  });
});
