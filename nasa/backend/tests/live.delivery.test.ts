import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';
import { signAccessToken } from '../src/core/tokens.js';
import { createSocketServer } from '../src/realtime/socket.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { type DeliveryPolicy } from '../src/bus/deliveryPolicy.js';
import { type Role } from '../src/core/roles.js';
import { type Envelope } from '../src/bus/eventTypes.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { User } from '../src/models/User.js';
import { setupTestMongo, teardownTestMongo, clearTestMongo, createTestUser } from './helpers.js';
import { CommsDelayEmulator } from '../src/link/commsDelayEmulator.js';
import { InMemoryLinkStore } from '../src/link/linkStore.js';
import { FakeClock } from '../src/core/clock.js';

describe('Socket.IO /live Delivery Policy and Token Refresh (F118)', () => {
  const secret = 'valid_test_access_secret_32_characters_long!';
  const config = parseConfig({
    ASTRO_JWT_ACCESS_SECRET: secret,
    ASTRO_EVENT_BUS_DRIVER: 'memory',
    ASTRO_SOCKET_AUTH_REFRESH_WARN_S: 1, // 1s lead time for fast testing
  });

  let httpServer: HttpServer;
  let port: number;
  let eventBus: MemoryEventBus;
  let fakePolicy: DeliveryPolicy;
  let emulator: CommsDelayEmulator;

  beforeAll(async () => {
    await setupTestMongo();

    eventBus = new MemoryEventBus();

    const linkStore = new InMemoryLinkStore();
    const clock = new FakeClock(Date.now());
    emulator = new CommsDelayEmulator({ clock, settings: config, linkStore });
    await emulator.refresh();

    // Fake delivery policy delaying ground roles by 200ms
    fakePolicy = {
      deliverAfterMs(_event: Envelope, role: Role): number {
        if (role === 'flight_surgeon' || role === 'mission_control') {
          return 200;
        }
        return 0;
      },
    };

    const app = createApp({
      settings: config,
      eventBus,
      deliveryPolicy: fakePolicy,
    });

    httpServer = createServer(app);
    createSocketServer(httpServer, {
      settings: config,
      eventBus,
      deliveryPolicy: fakePolicy,
      commsDelayEmulator: emulator,
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

  function createClient(auth: Record<string, unknown>): ClientSocket {
    return ioClient(`http://localhost:${port}/live`, {
      transports: ['websocket'],
      auth,
      autoConnect: false,
      reconnection: false,
    });
  }

  async function createAstronaut(callsign: string) {
    const profile = await CrewProfile.create({
      callsign,
      age: 30,
      sex: 'male',
      height_cm: 180,
      weight_kg: 75,
      medical_history: [],
      baseline: {},
      baseline_status: 'pending',
      is_synthetic: false,
    });
    const { user } = await createTestUser({ role: 'astronaut' });
    await User.findByIdAndUpdate(user._id, { crew_profile_id: profile._id });
    const token = signAccessToken(
      { userId: String(user._id), role: 'astronaut', isMedicalOfficer: false },
      secret,
      '15m',
    );
    return { user, token, crewId: String(profile._id) };
  }

  it('delivers events to astronauts immediately, but delays ground roles per DeliveryPolicy', async () => {
    const astro = await createAstronaut('Astro-Immediate');
    const { user: surgUser } = await createTestUser({ role: 'flight_surgeon' });
    const surgToken = signAccessToken(
      { userId: String(surgUser._id), role: 'flight_surgeon', isMedicalOfficer: false },
      secret,
      '15m',
    );

    const astroClient = createClient({ token: astro.token });
    const surgClient = createClient({ token: surgToken });

    const astroHello = new Promise<void>((r) => astroClient.on('hello', () => r()));
    const surgHello = new Promise<void>((r) => surgClient.on('hello', () => r()));

    astroClient.connect();
    surgClient.connect();

    await Promise.all([astroHello, surgHello]);

    let astroReceiptTime = 0;
    let surgReceiptTime = 0;
    const publishTime = Date.now();

    const astroPromise = new Promise<void>((resolve) => {
      astroClient.on('event', () => {
        astroReceiptTime = Date.now();
        resolve();
      });
    });

    const surgPromise = new Promise<void>((resolve) => {
      surgClient.on('event', () => {
        surgReceiptTime = Date.now();
        resolve();
      });
    });

    await eventBus.publish({
      topic: 'alerts',
      type: 'alert.raised',
      crew_id: astro.crewId,
      payload: { test: true },
    });

    await Promise.all([astroPromise, surgPromise]);

    const astroDelay = astroReceiptTime - publishTime;
    const surgDelay = surgReceiptTime - publishTime;

    // Astro got it almost immediately (< 100ms)
    expect(astroDelay).toBeLessThan(150);
    // Surgeon got it after ~200ms
    expect(surgDelay).toBeGreaterThanOrEqual(180);

    astroClient.disconnect();
    surgClient.disconnect();
  });

  it('emits auth:expiring warning, handles valid auth:refresh, and rejects refresh for another user', async () => {
    const { user } = await createTestUser({ role: 'admin' });
    // Token expiring in 2s (with warn lead time 1s, warning fires around 1s)
    const token = signAccessToken(
      { userId: String(user._id), role: 'admin', isMedicalOfficer: false },
      secret,
      '2s',
    );

    const client = createClient({ token });
    const helloPromise = new Promise<void>((resolve) => client.on('hello', () => resolve()));
    client.connect();
    await helloPromise;

    // 1. Wait for auth:expiring event
    const expiringData = await new Promise<Record<string, unknown>>((resolve) => {
      client.on('auth:expiring', (data: Record<string, unknown>) => resolve(data));
    });
    expect(expiringData['expires_at']).toBeTruthy();

    // 2. Reject refresh for a different user
    const { user: otherUser } = await createTestUser({ role: 'flight_surgeon' });
    const wrongUserToken = signAccessToken(
      { userId: String(otherUser._id), role: 'flight_surgeon', isMedicalOfficer: false },
      secret,
      '15m',
    );

    const failAck = await new Promise<Record<string, unknown>>((resolve) => {
      client.emit('auth:refresh', { token: wrongUserToken }, (ack: Record<string, unknown>) =>
        resolve(ack),
      );
    });
    expect(failAck['error']).toBeDefined();
    expect((failAck['error'] as { code: string }).code).toBe('FORBIDDEN');

    // 3. Successful refresh for the same user
    const newToken = signAccessToken(
      { userId: String(user._id), role: 'admin', isMedicalOfficer: false },
      secret,
      '15m',
    );

    const successAck = await new Promise<Record<string, unknown>>((resolve) => {
      client.emit('auth:refresh', { token: newToken }, (ack: Record<string, unknown>) =>
        resolve(ack),
      );
    });
    expect(successAck['ok']).toBe(true);
    expect(successAck['expires_at']).toBeTruthy();

    client.disconnect();
  });

  it('exposes link state in hello message and broadcasts link:state event when link state changes', async () => {
    const astro = await createAstronaut('Astro-LinkTest');
    const client = createClient({ token: astro.token });

    const helloPromise = new Promise<Record<string, unknown>>((resolve) => {
      client.on('hello', (data: Record<string, unknown>) => resolve(data));
    });

    const statePromise = new Promise<Record<string, unknown>>((resolve) => {
      client.on('link:state', (state: Record<string, unknown>) => resolve(state));
    });

    client.connect();

    const helloData = await helloPromise;
    expect(helloData['mission_mode']).toBe(config.mission_mode);
    expect(helloData['link_state']).toBeDefined();
    expect(typeof (helloData['link_state'] as Record<string, unknown>)['effectiveDelayMs']).toBe(
      'number',
    );

    // Trigger state change via override
    await emulator.setOverride('downlink', {
      force_blackout: true,
      actor_id: 'admin',
    });

    const broadcastedState = await statePromise;
    expect(broadcastedState['inBlackout']).toBe(true);
    expect(broadcastedState['overrideActive']).toBe(true);

    client.disconnect();
  });
});
