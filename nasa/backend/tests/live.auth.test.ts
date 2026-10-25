import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';
import { signAccessToken } from '../src/core/tokens.js';
import { createSocketServer } from '../src/realtime/socket.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { setupTestMongo, teardownTestMongo, clearTestMongo, createTestUser } from './helpers.js';

describe('Socket.IO /live Namespace Handshake and Auth (F118)', () => {
  const secret = 'valid_test_access_secret_32_characters_long!';
  const config = parseConfig({
    ASTRO_JWT_ACCESS_SECRET: secret,
    ASTRO_EVENT_BUS_DRIVER: 'memory',
  });

  let httpServer: HttpServer;
  let port: number;
  let eventBus: MemoryEventBus;

  beforeAll(async () => {
    await setupTestMongo();

    eventBus = new MemoryEventBus();
    const app = createApp({ settings: config, eventBus });

    httpServer = createServer(app);
    createSocketServer(httpServer, {
      settings: config,
      eventBus,
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
  });

  function connectClient(auth: Record<string, unknown>): ClientSocket {
    return ioClient(`http://localhost:${port}/live`, {
      transports: ['websocket'],
      auth,
      reconnection: false,
    });
  }

  it('connects with valid token and receives hello event when last_event_id is omitted', async () => {
    const { user } = await createTestUser({ role: 'flight_surgeon' });
    const token = signAccessToken(
      { userId: String(user._id), role: 'flight_surgeon', isMedicalOfficer: false },
      secret,
      '15m',
    );

    const client = connectClient({ token });

    const helloPayload = await new Promise<Record<string, unknown>>((resolve, reject) => {
      client.on('hello', (data: Record<string, unknown>) => resolve(data));
      client.on('connect_error', (err) => reject(err));
    });

    expect(helloPayload).toBeDefined();
    expect(helloPayload['server_time']).toBeTruthy();
    expect(helloPayload['mission_mode']).toBe('mars');

    client.disconnect();
  });

  it('rejects connection with UNAUTHENTICATED error when token is invalid or missing', async () => {
    const client = connectClient({ token: 'invalid_malformed_token' });

    const err = await new Promise<Error & { data?: { code: string } }>((resolve) => {
      client.on('connect_error', (error) => resolve(error as Error & { data?: { code: string } }));
    });

    expect(err.data?.code).toBe('UNAUTHENTICATED');
    client.disconnect();
  });

  it('rejects connection with TOKEN_EXPIRED error when token is expired', async () => {
    const { user } = await createTestUser({ role: 'astronaut' });
    const expiredToken = signAccessToken(
      { userId: String(user._id), role: 'astronaut', isMedicalOfficer: false },
      secret,
      '-10s',
    );

    const client = connectClient({ token: expiredToken });

    const err = await new Promise<Error & { data?: { code: string } }>((resolve) => {
      client.on('connect_error', (error) => resolve(error as Error & { data?: { code: string } }));
    });

    expect(err.data?.code).toBe('TOKEN_EXPIRED');
    client.disconnect();
  });

  it('rejects connection with VALIDATION_ERROR when last_event_id is malformed', async () => {
    const { user } = await createTestUser({ role: 'astronaut' });
    const token = signAccessToken(
      { userId: String(user._id), role: 'astronaut', isMedicalOfficer: false },
      secret,
      '15m',
    );

    const client = connectClient({ token, last_event_id: 'invalid-id-format' });

    const err = await new Promise<Error & { data?: { code: string } }>((resolve) => {
      client.on('connect_error', (error) => resolve(error as Error & { data?: { code: string } }));
    });

    expect(err.data?.code).toBe('VALIDATION_ERROR');
    client.disconnect();
  });

  it('responds to ping:app with server_time ack', async () => {
    const { user } = await createTestUser({ role: 'admin' });
    const token = signAccessToken(
      { userId: String(user._id), role: 'admin', isMedicalOfficer: false },
      secret,
      '15m',
    );

    const client = connectClient({ token });
    await new Promise<void>((resolve) => client.on('connect', () => resolve()));

    const ack = await new Promise<Record<string, unknown>>((resolve) => {
      client.emit('ping:app', (response: Record<string, unknown>) => resolve(response));
    });

    expect(ack['server_time']).toBeTruthy();
    client.disconnect();
  });
});
