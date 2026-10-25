import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { User } from '../src/models/User.js';
import { Reading, ensureReadingsCollection } from '../src/models/Reading.js';
import { signAccessToken } from '../src/core/tokens.js';
import { InMemoryQualityStateStore } from '../src/telemetry/qualityState.js';
import { InMemoryTelemetryPublisher } from '../src/telemetry/publisher.js';
import { MongoIdempotencyStore } from '../src/telemetry/idempotency.js';
import { InMemoryCrewIdCache } from '../src/telemetry/ingestService.js';
import { createSocketServer } from '../src/realtime/socket.js';
import { setupTestMongo, teardownTestMongo, clearTestMongo } from './helpers.js';

interface AckResponse {
  batch_id?: string;
  received?: number;
  accepted?: number;
  rejected?: Array<{ index: number; code: string; message: string }>;
  duplicates_in_batch?: number;
  interpolated?: number;
  gaps?: unknown[];
  quality?: {
    ok: number;
    flagged: number;
    by_flag: Record<string, number>;
  };
  error?: {
    code: string;
    message: string;
    request_id?: string;
    details?: Array<{ field: string; issue: string }>;
  };
}

interface SocketErrorData {
  code: string;
  message: string;
  details?: unknown;
}

describe('WebSocket Realtime Ingestion API (Socket.IO /ingest)', () => {
  const secret = 'valid_test_access_secret_32_characters_long!';
  const ingestKey = 'dev_test_insecure_ingest_api_key_32_chars!';
  const config = parseConfig({
    ASTRO_JWT_ACCESS_SECRET: secret,
    ASTRO_INGEST_API_KEY: ingestKey,
  });

  let httpServer: HttpServer;
  let port: number;
  let crew1Id: string;
  let crew2Id: string;
  let astronautUserId: string;

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

    const qualityStateStore = new InMemoryQualityStateStore();
    const publisher = new InMemoryTelemetryPublisher();
    const idempotencyStore = new MongoIdempotencyStore();
    const crewIdCache = new InMemoryCrewIdCache();

    const app = createApp({
      settings: config,
      qualityStateStore,
      publisher,
      idempotencyStore,
      crewIdCache,
    });

    httpServer = createServer(app);
    createSocketServer(httpServer, {
      settings: config,
      qualityStateStore,
      publisher,
      idempotencyStore,
      crewIdCache,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();

    const crew1 = await CrewProfile.create({
      callsign: 'PIONEER-1',
      age: 39,
      sex: 'male',
      height_cm: 180,
      weight_kg: 82,
      medical_history: [],
      baseline: {},
      baseline_status: 'pending',
      is_synthetic: true,
    });
    crew1Id = crew1._id.toString();

    const crew2 = await CrewProfile.create({
      callsign: 'PIONEER-2',
      age: 35,
      sex: 'female',
      height_cm: 170,
      weight_kg: 60,
      medical_history: [],
      baseline: {},
      baseline_status: 'pending',
      is_synthetic: true,
    });
    crew2Id = crew2._id.toString();

    const astronaut = await User.create({
      email: 'pioneer1@mars.nasa.gov',
      password_hash: 'hashed',
      display_name: 'Dr. Pioneer',
      role: 'astronaut',
      crew_profile_id: crew1._id,
    });
    astronautUserId = astronaut._id.toString();
  });

  function makeBatch(targetCrewId: string, batchId = 'ws-batch-01') {
    return {
      batch_id: batchId,
      readings: [
        {
          crew_id: targetCrewId,
          metric: 'heart_rate',
          value: 74,
          timestamp: '2026-10-18T15:00:00.000Z',
          source: 'simulated',
        },
      ],
    };
  }

  it('connects with valid ingest_key and receives 200 response matching HTTP shape on telemetry:batch', async () => {
    const client: ClientSocket = ioClient(`http://localhost:${port}/ingest`, {
      auth: { ingest_key: ingestKey },
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => resolve());
      client.on('connect_error', (err) => reject(err));
    });

    const response = await new Promise<AckResponse>((resolve) => {
      client.emit('telemetry:batch', makeBatch(crew1Id, 'batch-ws-ok'), (res: unknown) => {
        resolve(res as AckResponse);
      });
    });

    expect(response).toBeDefined();
    expect(response.batch_id).toBe('batch-ws-ok');
    expect(response.received).toBe(1);
    expect(response.accepted).toBe(1);
    expect(response.quality?.ok).toBe(1);
    expect(response.rejected).toHaveLength(0);

    const doc = await Reading.findOne({ batch_id: 'batch-ws-ok' });
    expect(doc).toBeDefined();
    expect(doc?.value).toBe(74);

    client.disconnect();
  });

  it('rejects connection at handshake when credentials are missing or invalid', async () => {
    const client: ClientSocket = ioClient(`http://localhost:${port}/ingest`, {
      auth: { ingest_key: 'invalid_ingest_key' },
      transports: ['websocket'],
      reconnection: false,
    });

    const errorData = await new Promise<SocketErrorData>((resolve) => {
      client.on('connect_error', (err: Error & { data?: SocketErrorData }) => {
        resolve(err.data ?? { code: 'UNKNOWN', message: err.message });
      });
    });

    expect(errorData).toBeDefined();
    expect(errorData.code).toBe('UNAUTHENTICATED');

    client.disconnect();
  });

  it('safely acks error contract on invalid batch payload without crashing server', async () => {
    const client: ClientSocket = ioClient(`http://localhost:${port}/ingest`, {
      auth: { ingest_key: ingestKey },
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve) => client.on('connect', () => resolve()));

    // Malformed reading payload (value not finite, timestamp not UTC Z)
    const malformedBatch = {
      readings: [
        {
          crew_id: crew1Id,
          metric: 'heart_rate',
          value: 'invalid_value_string',
          timestamp: 'not_a_date',
          source: 'simulated',
        },
      ],
    };

    const res = await new Promise<AckResponse>((resolve) => {
      client.emit('telemetry:batch', malformedBatch, (ack: unknown) => {
        resolve(ack as AckResponse);
      });
    });

    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe('VALIDATION_ERROR');
    expect(res.error?.details && res.error.details.length > 0).toBe(true);

    client.disconnect();
  });

  it('rejects astronaut submitting telemetry for another crew over WebSocket', async () => {
    const token = signAccessToken(
      { userId: astronautUserId, role: 'astronaut', isMedicalOfficer: false },
      secret,
    );

    const client: ClientSocket = ioClient(`http://localhost:${port}/ingest`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve) => client.on('connect', () => resolve()));

    // Astronaut linked to crew 1 attempts to submit telemetry for crew 2
    const res = await new Promise<AckResponse>((resolve) => {
      client.emit(
        'telemetry:batch',
        makeBatch(crew2Id, 'batch-forbidden-astro'),
        (ack: unknown) => {
          resolve(ack as AckResponse);
        },
      );
    });

    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe('FORBIDDEN');

    client.disconnect();
  });

  it('deduplicates replayed batch_id over WebSocket', async () => {
    const client: ClientSocket = ioClient(`http://localhost:${port}/ingest`, {
      auth: { ingest_key: ingestKey },
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve) => client.on('connect', () => resolve()));

    const batch = makeBatch(crew1Id, 'batch-ws-idempotent');

    // First emission
    const res1 = await new Promise<AckResponse>((resolve) => {
      client.emit('telemetry:batch', batch, (ack: unknown) => resolve(ack as AckResponse));
    });
    expect(res1.accepted).toBe(1);

    // Second emission with same batch_id and payload
    const res2 = await new Promise<AckResponse>((resolve) => {
      client.emit('telemetry:batch', batch, (ack: unknown) => resolve(ack as AckResponse));
    });
    expect(res2.accepted).toBe(1);

    // Persisted document count should be exactly 1
    const count = await Reading.countDocuments({ batch_id: 'batch-ws-idempotent' });
    expect(count).toBe(1);

    client.disconnect();
  });
});
