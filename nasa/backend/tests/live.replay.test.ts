import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';
import { signAccessToken } from '../src/core/tokens.js';
import { createSocketServer } from '../src/realtime/socket.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { type Envelope } from '../src/bus/eventTypes.js';
import { setupTestMongo, teardownTestMongo, clearTestMongo, createTestUser } from './helpers.js';

describe('Socket.IO /live Replay Protocol and Handoff (F118)', () => {
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

    eventBus = new MemoryEventBus({ maxLen: 1000 });
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

  const activeSockets: ClientSocket[] = [];

  afterEach(() => {
    for (const s of activeSockets) {
      if (s.connected) s.disconnect();
    }
    activeSockets.length = 0;
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
    const socket = ioClient(`http://localhost:${port}/live`, {
      transports: ['websocket'],
      auth,
      reconnection: false,
    });
    activeSockets.push(socket);
    return socket;
  }

  it('THE KEY TEST: disconnects, receives 21 missed events in order between replay:begin/end, and continues live without duplicates', async () => {
    const { user } = await createTestUser({ role: 'flight_surgeon' });
    const token = signAccessToken(
      { userId: String(user._id), role: 'flight_surgeon', isMedicalOfficer: false },
      secret,
      '15m',
    );

    // 1. Initial connection: receive hello with head_id
    let client = connectClient({ token });
    await new Promise<Record<string, unknown>>((resolve) => {
      client.on('hello', (data: Record<string, unknown>) => resolve(data));
    });

    // Publish an initial baseline event so stream has a start
    const baseline = await eventBus.publish({
      topic: 'alerts',
      type: 'alert.raised',
      payload: { index: -1 },
    });
    const lastEventId = baseline.id!;

    // 2. Disconnect client
    client.disconnect();

    // 3. While client is away, publish 20 alerts and 1 emergency
    const missedUids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const pub = await eventBus.publish({
        topic: 'alerts',
        type: 'alert.raised',
        payload: { index: i },
      });
      missedUids.push(pub.uid);
    }
    const emPub = await eventBus.publish({
      topic: 'emergency',
      type: 'emergency.declared',
      payload: { reason: 'decompression' },
    });
    missedUids.push(emPub.uid);

    // 4. Reconnect with last_event_id
    client = connectClient({ token, last_event_id: lastEventId });

    let replayBeginSeen = false;
    let replayEndSeen = false;
    const replayedUids: string[] = [];
    const allReceivedEvents: Envelope[] = [];

    client.on('replay:begin', () => {
      replayBeginSeen = true;
      // Publish concurrent live event during active replay handoff
      void eventBus.publish({
        topic: 'alerts',
        type: 'alert.raised',
        payload: { live: true },
      });
    });

    client.on('event', (e: Envelope) => {
      allReceivedEvents.push(e);
      if (replayBeginSeen && !replayEndSeen) {
        replayedUids.push(e.uid);
      }
    });

    const replayEndResult = await new Promise<Record<string, unknown>>((resolve) => {
      client.on('replay:end', (data: Record<string, unknown>) => {
        replayEndSeen = true;
        resolve(data);
      });
    });

    expect(replayBeginSeen).toBe(true);
    expect(replayEndSeen).toBe(true);
    expect(replayEndResult['count']).toBe(21);
    expect(replayEndResult['truncated']).toBe(false);

    // Check all 21 missed events were received in order
    expect(replayedUids).toEqual(missedUids);

    // Wait briefly for live buffer to flush
    await new Promise((r) => setTimeout(r, 200));

    // Verify the concurrent live event arrived
    const liveEvents = allReceivedEvents.filter((e) => e.payload['live'] === true);
    expect(liveEvents).toHaveLength(1);

    // Verify NO duplicates in all received events
    const allUids = allReceivedEvents.map((e) => e.uid);
    const uniqueUids = new Set(allUids);
    expect(uniqueUids.size).toBe(allUids.length);

    client.disconnect();
  });

  it('emits replay:resync when stream has been reset (future last_event_id)', async () => {
    const { user } = await createTestUser({ role: 'flight_surgeon' });
    const token = signAccessToken(
      { userId: String(user._id), role: 'flight_surgeon', isMedicalOfficer: false },
      secret,
      '15m',
    );

    await eventBus.publish({
      topic: 'alerts',
      type: 'alert.raised',
      payload: { test: true },
    });

    const client = connectClient({ token, last_event_id: '9999999999999-0' });

    const resyncData = await new Promise<Record<string, unknown>>((resolve) => {
      client.on('replay:resync', (data: Record<string, unknown>) => resolve(data));
    });

    expect(resyncData['reason']).toBe('reset');
    expect(Array.isArray(resyncData['resync'])).toBe(true);

    client.disconnect();
  });
});
