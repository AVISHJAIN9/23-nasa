import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestMongo,
  teardownTestMongo,
  clearTestMongo,
  createTestApp,
  createTestUser,
  authHeader,
} from './helpers.js';
import { CrewProfile } from '../src/models/CrewProfile.js';

describe('Crew Profile CRUD & Medical Privacy (F002)', () => {
  beforeAll(async () => {
    await setupTestMongo();
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();
  });

  it('allows astronaut to read only their own profile, denying other crew members', async () => {
    const { user: astro1 } = await createTestUser({ role: 'astronaut' });
    const { user: astro2 } = await createTestUser({ role: 'astronaut' });

    const profile1 = await CrewProfile.create({
      user_id: astro1._id,
      callsign: 'Ares-1',
      age: 32,
      sex: 'male',
      height_cm: 180,
      weight_kg: 75,
      medical_history: ['Appendectomy 2020'],
    });
    astro1.crew_profile_id = profile1._id;
    await astro1.save();

    const profile2 = await CrewProfile.create({
      user_id: astro2._id,
      callsign: 'Ares-2',
      age: 29,
      sex: 'female',
      height_cm: 168,
      weight_kg: 60,
      medical_history: ['None'],
    });
    astro2.crew_profile_id = profile2._id;
    await astro2.save();

    const { agent } = createTestApp();

    // 1. Astro 1 reads own profile -> 200
    const ownRes = await agent
      .get(`/v1/crew/${profile1.id}`)
      .set('Authorization', authHeader(astro1.id, 'astronaut'));
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.callsign).toBe('Ares-1');

    // 2. Astro 1 tries to read Astro 2's profile -> 403
    const otherRes = await agent
      .get(`/v1/crew/${profile2.id}`)
      .set('Authorization', authHeader(astro1.id, 'astronaut'));
    expect(otherRes.status).toBe(403);
    expect(otherRes.body.error.code).toBe('FORBIDDEN');
  });

  it('redacts sensitive medical_history for mission_control callers', async () => {
    const profile = await CrewProfile.create({
      callsign: 'Ares-3',
      age: 40,
      sex: 'male',
      height_cm: 182,
      weight_kg: 79,
      medical_history: ['Cardiac arrhythmia in high-G centrifuge test'],
    });

    const { agent } = createTestApp();

    // 1. Flight surgeon receives medical_history
    const surgeonRes = await agent
      .get(`/v1/crew/${profile.id}`)
      .set('Authorization', authHeader('surgeon-1', 'flight_surgeon'));
    expect(surgeonRes.status).toBe(200);
    expect(surgeonRes.body.medical_history).toBeDefined();
    expect(surgeonRes.body.medical_history).toContain(
      'Cardiac arrhythmia in high-G centrifuge test',
    );

    // 2. Mission control must NOT receive medical_history
    const controlRes = await agent
      .get(`/v1/crew/${profile.id}`)
      .set('Authorization', authHeader('control-1', 'mission_control'));
    expect(controlRes.status).toBe(200);
    expect(controlRes.body.medical_history).toBeUndefined();

    // 3. Mission control listing also omits medical_history
    const listRes = await agent
      .get('/v1/crew')
      .set('Authorization', authHeader('control-1', 'mission_control'));
    expect(listRes.status).toBe(200);
    expect(listRes.body.items[0].medical_history).toBeUndefined();
  });

  it('rejects attempts to patch baseline vitals through crew profile API', async () => {
    const { user: admin } = await createTestUser({ role: 'admin' });
    const profile = await CrewProfile.create({
      callsign: 'Ares-4',
      age: 35,
      sex: 'female',
      height_cm: 170,
      weight_kg: 62,
    });

    const { agent } = createTestApp();

    const patchRes = await agent
      .patch(`/v1/crew/${profile.id}`)
      .set('Authorization', authHeader(admin.id, 'admin'))
      .send({
        baseline: { resting_hr: 50 },
      });

    expect(patchRes.status).toBe(422);
    expect(patchRes.body.error.code).toBe('VALIDATION_ERROR');
    expect(patchRes.body.error.message).toContain('Baseline');
  });

  it('validates physiological limits rejecting impossible values', async () => {
    const { user: admin } = await createTestUser({ role: 'admin' });
    const { agent } = createTestApp();

    // Age 14 (too young)
    const youngRes = await agent
      .post('/v1/crew')
      .set('Authorization', authHeader(admin.id, 'admin'))
      .send({
        callsign: 'Cadet-1',
        age: 14,
        sex: 'other',
        height_cm: 170,
        weight_kg: 60,
      });

    expect(youngRes.status).toBe(422);
    expect(youngRes.body.error.code).toBe('VALIDATION_ERROR');

    // Age 99 (too old)
    const oldRes = await agent
      .post('/v1/crew')
      .set('Authorization', authHeader(admin.id, 'admin'))
      .send({
        callsign: 'Veteran-1',
        age: 99,
        sex: 'other',
        height_cm: 170,
        weight_kg: 60,
      });

    expect(oldRes.status).toBe(422);
  });

  it('rejects invalid ObjectId route parameter with 422 VALIDATION_ERROR', async () => {
    const { agent } = createTestApp();

    const res = await agent
      .get('/v1/crew/not-a-valid-hex-id')
      .set('Authorization', authHeader('admin-1', 'admin'));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('supports cursor-based pagination with limit', async () => {
    for (let i = 1; i <= 5; i++) {
      await CrewProfile.create({
        callsign: `Crew-${i}`,
        age: 30 + i,
        sex: 'other',
        height_cm: 170 + i,
        weight_kg: 65 + i,
      });
    }

    const { agent } = createTestApp();

    // Page 1: limit 2
    const page1Res = await agent
      .get('/v1/crew?limit=2')
      .set('Authorization', authHeader('admin-1', 'admin'));

    expect(page1Res.status).toBe(200);
    expect(page1Res.body.items.length).toBe(2);
    expect(page1Res.body.next_cursor).toBeDefined();

    // Page 2: with cursor
    const cursor = page1Res.body.next_cursor;
    const page2Res = await agent
      .get(`/v1/crew?limit=2&cursor=${cursor}`)
      .set('Authorization', authHeader('admin-1', 'admin'));

    expect(page2Res.status).toBe(200);
    expect(page2Res.body.items.length).toBe(2);
    expect(page2Res.body.items[0].id).not.toBe(page1Res.body.items[0].id);
  });

  describe('PUT /v1/crew/:id/baseline (ML Sidecar & Flight Surgeon baseline updates)', () => {
    it('allows ML service with valid X-ML-Key to update baseline vitals and sets baseline_status to computed', async () => {
      const profile = await CrewProfile.create({
        callsign: 'Ares-ML',
        age: 35,
        sex: 'female',
        height_cm: 172,
        weight_kg: 65,
        baseline_status: 'pending',
      });

      const { agent, settings } = createTestApp();

      const res = await agent
        .put(`/v1/crew/${profile.id}/baseline`)
        .set('X-ML-Key', settings.ml_api_key)
        .send({
          resting_hr: 62,
          spo2: 98,
          systolic: 118,
          diastolic: 76,
          temp_c: 36.6,
          resp_rate: 14,
          hrv_rmssd: 45,
        });

      expect(res.status).toBe(200);
      expect(res.body.baseline_status).toBe('computed');
      expect(res.body.baseline.resting_hr).toBe(62);
      expect(res.body.baseline.spo2).toBe(98);
      expect(res.body.baseline.systolic).toBe(118);
      expect(res.body.baseline.diastolic).toBe(76);
      expect(res.body.baseline.temp_c).toBe(36.6);
      expect(res.body.baseline.resp_rate).toBe(14);
      expect(res.body.baseline.hrv_rmssd).toBe(45);

      const updated = await CrewProfile.findById(profile.id);
      expect(updated?.baseline_status).toBe('computed');
      expect(updated?.baseline.resting_hr).toBe(62);
    });

    it('allows flight_surgeon to update baseline vitals', async () => {
      const profile = await CrewProfile.create({
        callsign: 'Ares-Surgeon',
        age: 38,
        sex: 'male',
        height_cm: 180,
        weight_kg: 78,
      });

      const { agent } = createTestApp();

      const res = await agent
        .put(`/v1/crew/${profile.id}/baseline`)
        .set('Authorization', authHeader('surgeon-1', 'flight_surgeon'))
        .send({
          baseline: {
            resting_hr: 60,
            spo2: 99,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.baseline_status).toBe('computed');
      expect(res.body.baseline.resting_hr).toBe(60);
      expect(res.body.baseline.spo2).toBe(99);
    });

    it('rejects unauthenticated request or astronaut role without medical permissions', async () => {
      const profile = await CrewProfile.create({
        callsign: 'Ares-Astronaut',
        age: 30,
        sex: 'other',
        height_cm: 175,
        weight_kg: 70,
      });

      const { agent } = createTestApp();

      // Astronaut role -> 403 Forbidden
      const res = await agent
        .put(`/v1/crew/${profile.id}/baseline`)
        .set('Authorization', authHeader('astro-1', 'astronaut'))
        .send({
          resting_hr: 60,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
