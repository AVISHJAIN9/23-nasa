import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { Reading, ensureReadingsCollection } from '../src/models/Reading.js';
import { setupTestMongo, teardownTestMongo, clearTestMongo } from './helpers.js';

describe('HTTP Telemetry Ingestion API (F013)', () => {
  const ingestKey = 'dev_test_insecure_ingest_api_key_32_chars!';
  const config = parseConfig({
    ASTRO_INGEST_API_KEY: ingestKey,
    ASTRO_TELEMETRY_MAX_BATCH: '500',
  });

  const app = createApp(config);
  let crewId: string;

  beforeAll(async () => {
    await setupTestMongo();
    if (mongoose.connection.db) {
      try {
        await mongoose.connection.db.dropCollection('readings');
      } catch {
        // collection did not exist yet
      }
    }
    await ensureReadingsCollection(0);
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();

    const crew = await CrewProfile.create({
      callsign: 'DISCOVERY-1',
      age: 41,
      sex: 'male',
      height_cm: 182,
      weight_kg: 80,
      medical_history: [],
      baseline: {},
      baseline_status: 'pending',
      is_synthetic: true,
    });
    crewId = crew._id.toString();
  });

  function validReading(overrides: Record<string, unknown> = {}) {
    return {
      crew_id: crewId,
      metric: 'heart_rate',
      value: 72,
      timestamp: '2026-10-18T12:00:00.000Z',
      source: 'simulated',
      ...overrides,
    };
  }

  it('verifies time-series collection is created with correct timeField and metaField', async () => {
    const db = mongoose.connection.db!;
    const collections = await db.listCollections({ name: 'readings' }).toArray();
    expect(collections).toHaveLength(1);

    const coll = collections[0] as {
      type?: string;
      options?: { timeseries?: { timeField: string; metaField: string; granularity: string } };
    };
    expect(coll.type === 'timeseries' || coll.options?.timeseries !== undefined).toBe(true);
    expect(coll.options?.timeseries?.timeField).toBe('timestamp');
    expect(coll.options?.timeseries?.metaField).toBe('meta');
  });

  it('rejects invalid metric with 422 and dotted path body.readings.0.metric', async () => {
    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send({
        readings: [validReading({ metric: 'unknown_vital_sensor' })],
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const detail = res.body.error.details.find(
      (d: { field: string }) => d.field === 'body.readings.0.metric',
    );
    expect(detail).toBeDefined();
  });

  it('rejects non-finite value with 422 and dotted path body.readings.0.value', async () => {
    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send({
        readings: [validReading({ value: 'not-a-number' })],
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const detail = res.body.error.details.find(
      (d: { field: string }) => d.field === 'body.readings.0.value',
    );
    expect(detail).toBeDefined();
  });

  it('rejects timestamp with timezone offset with 422 and dotted path body.readings.0.timestamp', async () => {
    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send({
        readings: [validReading({ timestamp: '2026-10-18T12:00:00+02:00' })],
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const detail = res.body.error.details.find(
      (d: { field: string }) => d.field === 'body.readings.0.timestamp',
    );
    expect(detail).toBeDefined();
    expect(detail.issue).toMatch(/ending in "Z"/);
  });

  it('rejects invalid ObjectId hex string with 422 and dotted path body.readings.0.crew_id', async () => {
    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send({
        readings: [validReading({ crew_id: 'not-a-24-char-hex-id' })],
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const detail = res.body.error.details.find(
      (d: { field: string }) => d.field === 'body.readings.0.crew_id',
    );
    expect(detail).toBeDefined();
  });

  it('rejects replayed_dataset without dataset_id with 422 and dotted path body.readings.0.dataset_id', async () => {
    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send({
        readings: [validReading({ source: 'replayed_dataset', dataset_id: undefined })],
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const detail = res.body.error.details.find(
      (d: { field: string }) => d.field === 'body.readings.0.dataset_id',
    );
    expect(detail).toBeDefined();
  });

  it('rejects mismatched unit with 422 and dotted path body.readings.0.unit', async () => {
    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send({
        readings: [validReading({ metric: 'heart_rate', unit: 'mmHg' })], // bpm expected
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const detail = res.body.error.details.find(
      (d: { field: string }) => d.field === 'body.readings.0.unit',
    );
    expect(detail).toBeDefined();
  });

  it('rejects empty batch with 422 and dotted path body.readings', async () => {
    const res = await request(app).post('/v1/telemetry').set('X-Ingest-Key', ingestKey).send({
      readings: [],
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const detail = res.body.error.details.find(
      (d: { field: string }) => d.field === 'body.readings',
    );
    expect(detail).toBeDefined();
  });

  it('rejects batch exceeding max batch size with 422 and dotted path body.readings', async () => {
    const oversizedBatch = Array.from({ length: 501 }, (_, i) =>
      validReading({ timestamp: new Date(Date.now() + i * 1000).toISOString() }),
    );

    const res = await request(app).post('/v1/telemetry').set('X-Ingest-Key', ingestKey).send({
      readings: oversizedBatch,
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('handles unknown crew_id in mixed batch: rejects individual reading while processing valid ones', async () => {
    const nonExistentCrewId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send({
        batch_id: 'batch-mixed-crew',
        readings: [
          validReading({ timestamp: '2026-10-18T12:00:00.000Z' }),
          validReading({ crew_id: nonExistentCrewId, timestamp: '2026-10-18T12:00:01.000Z' }),
          validReading({ timestamp: '2026-10-18T12:00:02.000Z' }),
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(3);
    expect(res.body.accepted).toBe(2);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].index).toBe(1);
    expect(res.body.rejected[0].code).toBe('CREW_NOT_FOUND');
  });

  it('rejects batch with 422 VALIDATION_ERROR when every reading is for an unknown crew', async () => {
    const nonExistentCrewId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send({
        batch_id: 'batch-all-unknown',
        readings: [
          validReading({ crew_id: nonExistentCrewId, timestamp: '2026-10-18T12:00:00.000Z' }),
          validReading({ crew_id: nonExistentCrewId, timestamp: '2026-10-18T12:00:01.000Z' }),
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toHaveLength(2);
  });

  it('persists readings into time-series collection with meta, quality, batch_id', async () => {
    const batchId = 'batch-persist-verify-01';

    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send({
        batch_id: batchId,
        readings: [
          validReading({
            value: 78,
            timestamp: '2026-10-18T12:30:00.000Z',
            mission_day: 42,
            device_id: 'sensor-hex-9',
          }),
        ],
      });

    expect(res.status).toBe(200);

    const doc = await Reading.findOne({ batch_id: batchId });
    expect(doc).toBeDefined();
    expect(doc?.meta?.crew_id?.toString()).toBe(crewId);
    expect(doc?.meta?.metric).toBe('heart_rate');
    expect(doc?.meta?.source).toBe('simulated');
    expect(doc?.value).toBe(78);
    expect(doc?.unit).toBe('bpm');
    expect(doc?.quality.flag).toBe('ok');
    expect(doc?.mission_day).toBe(42);
    expect(doc?.device_id).toBe('sensor-hex-9');
  });

  it('collapses duplicates in same batch to last-wins and counts duplicates_in_batch', async () => {
    const timestamp = '2026-10-18T13:00:00.000Z';

    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send({
        batch_id: 'batch-dedup-internal',
        readings: [
          validReading({ value: 70, timestamp }),
          validReading({ value: 85, timestamp }), // duplicate, last wins
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(2);
    expect(res.body.accepted).toBe(1);
    expect(res.body.duplicates_in_batch).toBe(1);

    const stored = await Reading.find({ batch_id: 'batch-dedup-internal' });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.value).toBe(85);
  });
});
