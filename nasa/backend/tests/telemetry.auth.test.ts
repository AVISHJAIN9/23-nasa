import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/core/tokens.js';
import { setupTestMongo, teardownTestMongo, clearTestMongo } from './helpers.js';

describe('Telemetry Ingestion Authentication & Authorization (ingestAuth)', () => {
  const secret = 'valid_test_access_secret_32_characters_long!';
  const ingestKey = 'dev_test_insecure_ingest_api_key_32_chars!';
  const config = parseConfig({
    ASTRO_JWT_ACCESS_SECRET: secret,
    ASTRO_INGEST_API_KEY: ingestKey,
  });

  const app = createApp(config);

  let crew1Id: string;
  let crew2Id: string;
  let astronautUser1Id: string;
  let adminUserId: string;
  let surgeonUserId: string;
  let missionControlUserId: string;

  beforeAll(async () => {
    await setupTestMongo();
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();

    // Create crew 1
    const crew1 = await CrewProfile.create({
      callsign: 'ARES-1',
      age: 38,
      sex: 'male',
      height_cm: 180,
      weight_kg: 78,
      medical_history: [],
      baseline: {},
      baseline_status: 'pending',
      is_synthetic: true,
    });
    crew1Id = crew1._id.toString();

    // Create crew 2
    const crew2 = await CrewProfile.create({
      callsign: 'ARES-2',
      age: 34,
      sex: 'female',
      height_cm: 168,
      weight_kg: 62,
      medical_history: [],
      baseline: {},
      baseline_status: 'pending',
      is_synthetic: true,
    });
    crew2Id = crew2._id.toString();

    // Astronaut linked to crew 1
    const astro1 = await User.create({
      email: 'astro1@mars.nasa.gov',
      password_hash: 'hashed',
      display_name: 'Dr. John Ares',
      role: 'astronaut',
      crew_profile_id: crew1._id,
    });
    astronautUser1Id = astro1._id.toString();
    crew1.user_id = astro1._id;
    await crew1.save();

    // Admin
    const admin = await User.create({
      email: 'admin@mars.nasa.gov',
      password_hash: 'hashed',
      display_name: 'System Admin',
      role: 'admin',
    });
    adminUserId = admin._id.toString();

    // Flight Surgeon
    const surgeon = await User.create({
      email: 'surgeon@mars.nasa.gov',
      password_hash: 'hashed',
      display_name: 'Flight Surgeon Dr. Smith',
      role: 'flight_surgeon',
    });
    surgeonUserId = surgeon._id.toString();

    // Mission Control
    const mc = await User.create({
      email: 'mc@mars.nasa.gov',
      password_hash: 'hashed',
      display_name: 'Flight Director',
      role: 'mission_control',
    });
    missionControlUserId = mc._id.toString();
  });

  function makeBatch(targetCrewId: string) {
    return {
      batch_id: 'batch-auth-test',
      readings: [
        {
          crew_id: targetCrewId,
          metric: 'heart_rate',
          value: 75,
          timestamp: '2026-10-18T10:00:00.000Z',
          source: 'simulated',
        },
      ],
    };
  }

  it('rejects request with no credentials with 401 UNAUTHENTICATED', async () => {
    const res = await request(app).post('/v1/telemetry').send(makeBatch(crew1Id));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects request with wrong ingest key with 401 UNAUTHENTICATED', async () => {
    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', 'wrong_ingest_key_that_does_not_match!')
      .send(makeBatch(crew1Id));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('accepts request with valid X-Ingest-Key with 200 OK for any crew', async () => {
    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send(makeBatch(crew1Id));

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
    expect(res.body.received).toBe(1);
  });

  it('accepts request with admin JWT for any crew with 200 OK', async () => {
    const token = signAccessToken(
      { userId: adminUserId, role: 'admin', isMedicalOfficer: false },
      secret,
    );

    const res = await request(app)
      .post('/v1/telemetry')
      .set('Authorization', `Bearer ${token}`)
      .send(makeBatch(crew2Id));

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
  });

  it('accepts request from astronaut for their own crew with 200 OK', async () => {
    const token = signAccessToken(
      { userId: astronautUser1Id, role: 'astronaut', isMedicalOfficer: false },
      secret,
    );

    const res = await request(app)
      .post('/v1/telemetry')
      .set('Authorization', `Bearer ${token}`)
      .send(makeBatch(crew1Id));

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
  });

  it('rejects request with 403 FORBIDDEN if astronaut sends reading for another crew', async () => {
    const token = signAccessToken(
      { userId: astronautUser1Id, role: 'astronaut', isMedicalOfficer: false },
      secret,
    );

    // Astronaut 1 attempting to write for crew 2
    const res = await request(app)
      .post('/v1/telemetry')
      .set('Authorization', `Bearer ${token}`)
      .send(makeBatch(crew2Id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects flight_surgeon with 403 FORBIDDEN', async () => {
    const token = signAccessToken(
      { userId: surgeonUserId, role: 'flight_surgeon', isMedicalOfficer: false },
      secret,
    );

    const res = await request(app)
      .post('/v1/telemetry')
      .set('Authorization', `Bearer ${token}`)
      .send(makeBatch(crew1Id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects mission_control with 403 FORBIDDEN', async () => {
    const token = signAccessToken(
      { userId: missionControlUserId, role: 'mission_control', isMedicalOfficer: false },
      secret,
    );

    const res = await request(app)
      .post('/v1/telemetry')
      .set('Authorization', `Bearer ${token}`)
      .send(makeBatch(crew1Id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
