import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';
import { signAccessToken } from '../src/core/tokens.js';
import { createSocketServer } from '../src/realtime/socket.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { type Envelope } from '../src/bus/eventTypes.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { User } from '../src/models/User.js';
import { setupTestMongo, teardownTestMongo, clearTestMongo, createTestUser } from './helpers.js';

describe('Emergency Broadcast Performance (F063)', () => {
  const secret = 'valid_test_access_secret_32_characters_long!';
  const config = parseConfig({
    ASTRO_JWT_ACCESS_SECRET: secret,
    ASTRO_EVENT_BUS_DRIVER: 'memory',
  });

  let httpServer: HttpServer;
  let port: number;
  let eventBus: MemoryEventBus;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    await setupTestMongo();

    eventBus = new MemoryEventBus();
    app = createApp({ settings: config, eventBus });

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

  function connectClient(token: string): ClientSocket {
    const socket = ioClient(`http://localhost:${port}/live`, {
      transports: ['websocket'],
      auth: { token },
      autoConnect: false,
      reconnection: false,
    });
    activeSockets.push(socket);
    return socket;
  }

  async function createAstronautWithProfile(callsign: string) {
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

  it('broadcasts an emergency declaration to all connected roles (and 20 extra clients) in under 3 s', async () => {
    // 1. Create role users
    const astro1 = await createAstronautWithProfile('Astro-Declaring');
    const astro2 = await createAstronautWithProfile('Astro-OtherCrew');
    const { user: surgUser } = await createTestUser({ role: 'flight_surgeon' });
    const surgToken = signAccessToken(
      { userId: String(surgUser._id), role: 'flight_surgeon', isMedicalOfficer: false },
      secret,
      '15m',
    );
    const { user: mcUser } = await createTestUser({ role: 'mission_control' });
    const mcToken = signAccessToken(
      { userId: String(mcUser._id), role: 'mission_control', isMedicalOfficer: false },
      secret,
      '15m',
    );
    const { user: adminUser } = await createTestUser({ role: 'admin' });
    const adminToken = signAccessToken(
      { userId: String(adminUser._id), role: 'admin', isMedicalOfficer: false },
      secret,
      '15m',
    );

    const clientTokens = [astro1.token, astro2.token, surgToken, mcToken, adminToken];

    // Add 20 extra clients (mixed roles)
    for (let i = 0; i < 20; i++) {
      const extraToken = signAccessToken(
        {
          userId: `extra-user-${i}`,
          role: i % 2 === 0 ? 'flight_surgeon' : 'mission_control',
          isMedicalOfficer: false,
        },
        secret,
        '15m',
      );
      clientTokens.push(extraToken);
    }

    const sockets: ClientSocket[] = [];
    const connectionPromises: Promise<void>[] = [];

    for (const token of clientTokens) {
      const socket = connectClient(token);
      sockets.push(socket);
      connectionPromises.push(new Promise<void>((r) => socket.on('hello', () => r())));
      socket.connect();
    }

    // Wait for all 25 clients to connect
    await Promise.all(connectionPromises);

    // 2. Prepare receipt promises
    const receiptPromises = sockets.map(
      (socket) =>
        new Promise<Envelope>((resolve) => {
          socket.on('event', (e: Envelope) => {
            if (e.type === 'emergency.declared') {
              resolve(e);
            }
          });
        }),
    );

    // 3. Post emergency declaration through the REST API
    const startPost = performance.now();
    const res = await request(app)
      .post('/v1/emergencies')
      .set('Authorization', `Bearer ${astro1.token}`)
      .send({
        type: 'cardiac',
        note: 'Severe cardiac distress detected in Sector 4',
        client_request_id: randomUUID(),
      });

    expect(res.status).toBe(201);

    // 4. Wait for all 25 clients to receive the emergency event
    const receivedEvents = await Promise.all(receiptPromises);
    const totalElapsedMs = performance.now() - startPost;

    // Check delivery latency: MUST be under 3000 ms
    expect(totalElapsedMs).toBeLessThan(3000);
    expect(receivedEvents).toHaveLength(25);

    // Check that astro2 (from another crew) received it too!
    const astro2Event = receivedEvents[1];
    expect(astro2Event.type).toBe('emergency.declared');
    expect(astro2Event.topic).toBe('emergency');

    // Clean up
    for (const socket of sockets) {
      socket.disconnect();
    }
  });
});
