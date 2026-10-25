import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { Reading, ensureReadingsCollection } from '../src/models/Reading.js';
import { IdempotencyRecord } from '../src/models/IdempotencyRecord.js';
import { setupTestMongo, teardownTestMongo, clearTestMongo } from './helpers.js';

describe('Telemetry Ingestion Idempotency & Retry Dedup (F013)', () => {
  const ingestKey = 'dev_test_insecure_ingest_api_key_32_chars!';
  const config = parseConfig({
    ASTRO_INGEST_API_KEY: ingestKey,
  });

  const app = createApp(config);
  let crewId: string;

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

    const crew = await CrewProfile.create({
      callsign: 'VOYAGER-1',
      age: 45,
      sex: 'male',
      height_cm: 175,
      weight_kg: 75,
      medical_history: [],
      baseline: {},
      baseline_status: 'pending',
      is_synthetic: true,
    });
    crewId = crew._id.toString();
  });

  function makePayload(val = 75) {
    return {
      batch_id: 'batch-idempotency-01',
      readings: [
        {
          crew_id: crewId,
          metric: 'heart_rate',
          value: val,
          timestamp: '2026-10-18T14:00:00.000Z',
          source: 'simulated',
        },
      ],
    };
  }

  it('replays identical response with Idempotency-Replayed header on retry with same key and body', async () => {
    const key = 'custom-idemp-key-101';
    const payload = makePayload(75);

    // Initial request
    const res1 = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .set('Idempotency-Key', key)
      .send(payload);

    expect(res1.status).toBe(200);
    expect(res1.header['idempotency-replayed']).toBeUndefined();
    expect(res1.body.accepted).toBe(1);

    const countAfterFirst = await Reading.countDocuments();
    expect(countAfterFirst).toBe(1);

    // Replayed retry
    const res2 = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .set('Idempotency-Key', key)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.header['idempotency-replayed']).toBe('true');
    expect(res2.body).toEqual(res1.body);

    // Stored reading count unchanged
    const countAfterRetry = await Reading.countDocuments();
    expect(countAfterRetry).toBe(1);
  });

  it('returns 409 CONFLICT when same key is sent with different body', async () => {
    const key = 'custom-idemp-key-conflict';

    // Request 1 with value 75
    const res1 = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .set('Idempotency-Key', key)
      .send(makePayload(75));

    expect(res1.status).toBe(200);

    // Request 2 with same key but different value 90
    const res2 = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .set('Idempotency-Key', key)
      .send(makePayload(90));

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('CONFLICT');
  });

  it('deduplicates identical requests using implicit hash key when no header or batch_id provided', async () => {
    const payloadWithoutBatchId = {
      readings: [
        {
          crew_id: crewId,
          metric: 'spo2',
          value: 98,
          timestamp: '2026-10-18T14:10:00.000Z',
          source: 'simulated',
        },
      ],
    };

    // First call without Idempotency-Key or batch_id
    const res1 = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send(payloadWithoutBatchId);

    expect(res1.status).toBe(200);
    expect(res1.header['idempotency-replayed']).toBeUndefined();

    // Identical second call -> implicit hash matches -> replayed!
    const res2 = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .send(payloadWithoutBatchId);

    expect(res2.status).toBe(200);
    expect(res2.header['idempotency-replayed']).toBe('true');

    // Only 1 document inserted
    const count = await Reading.countDocuments();
    expect(count).toBe(1);
  });

  it('stores readings exactly once when 5 identical requests execute concurrently', async () => {
    const key = 'concurrent-test-key-5';
    const payload = makePayload(82);

    const promises = Array.from({ length: 5 }, () =>
      request(app)
        .post('/v1/telemetry')
        .set('X-Ingest-Key', ingestKey)
        .set('Idempotency-Key', key)
        .send(payload),
    );

    const responses = await Promise.all(promises);

    // All should be 200 (either initial winner or replay) or 409 (if hit during processing)
    const success200 = responses.filter((r) => r.status === 200);
    expect(success200.length).toBeGreaterThanOrEqual(1);

    // Documents must only be inserted ONCE
    const count = await Reading.countDocuments();
    expect(count).toBe(1);
  });

  it('allows takeover of expired processing lease (> 60s)', async () => {
    const key = 'expired-lease-key';
    const payload = makePayload(70);

    // Seed an abandoned record in "processing" state created 70 seconds ago with same payload
    const seventySecondsAgo = new Date(Date.now() - 70_000);
    const { computePayloadHash } = await import('../src/telemetry/idempotency.js');
    await IdempotencyRecord.create({
      scope: 'ingest_service',
      key,
      request_hash: computePayloadHash(payload),
      status: 'processing',
      created_at: seventySecondsAgo,
      updated_at: seventySecondsAgo,
    });

    // Request with same key should assume the lease and succeed
    const res = await request(app)
      .post('/v1/telemetry')
      .set('X-Ingest-Key', ingestKey)
      .set('Idempotency-Key', key)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);

    const updatedRecord = await IdempotencyRecord.findOne({
      scope: 'ingest_service',
      key,
    });
    expect(updatedRecord?.status).toBe('done');
  });

  it('verifies TTL index exists on created_at', async () => {
    const indexes = await IdempotencyRecord.collection.indexes();
    const ttlIndex = indexes.find(
      (idx) => idx.key['created_at'] === 1 && idx.expireAfterSeconds !== undefined,
    );
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex?.expireAfterSeconds).toBe(24 * 3600);
  });
});
