import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/core/config.js';
import { signAccessToken } from '../src/core/tokens.js';
import { createSocketServer } from '../src/realtime/socket.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { NoDelayPolicy } from '../src/bus/deliveryPolicy.js';
import { InboxPublisher } from '../src/fusion/inboxPublisher.js';
import { FusedAlert } from '../src/models/FusedAlert.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { setupTestMongo, teardownTestMongo, clearTestMongo, createTestUser } from './helpers.js';
import { type Envelope } from '../src/bus/eventTypes.js';

describe('Live Inbox Socket.IO Delivery & Projection (F097 / F118)', () => {
  const secret = 'valid_test_access_secret_32_characters_long!';
  const config = parseConfig({
    ASTRO_JWT_ACCESS_SECRET: secret,
    ASTRO_EVENT_BUS_DRIVER: 'memory',
  });

  let httpServer: HttpServer;
  let port: number;
  let eventBus: MemoryEventBus;
  let inboxPublisher: InboxPublisher;
  let crewProfileId: string;
  let surgeonUser: Awaited<ReturnType<typeof createTestUser>>['user'];
  let mcUser: Awaited<ReturnType<typeof createTestUser>>['user'];

  beforeAll(async () => {
    await setupTestMongo();

    eventBus = new MemoryEventBus();
    const policy = new NoDelayPolicy();
    inboxPublisher = new InboxPublisher(eventBus);

    const app = createApp({
      settings: config,
      eventBus,
      deliveryPolicy: policy,
    });

    httpServer = createServer(app);
    createSocketServer(httpServer, {
      settings: config,
      eventBus,
      deliveryPolicy: policy,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  let sockets: ClientSocket[] = [];

  afterEach(() => {
    for (const s of sockets) {
      if (s.connected) s.disconnect();
    }
    sockets = [];
  });

  afterAll(async () => {
    if (httpServer) {
      httpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();

    const profile = await CrewProfile.create({
      callsign: 'Discovery-Live',
      age: 42,
      sex: 'male',
      height_cm: 182,
      weight_kg: 82,
      baseline: {},
      is_synthetic: true,
    });
    crewProfileId = profile._id.toString();

    const surgeon = await createTestUser({ role: 'flight_surgeon', display_name: 'Dr. Bowman' });
    const mc = await createTestUser({ role: 'mission_control', display_name: 'Flight Lead' });

    surgeonUser = {
      ...surgeon,
      token: signAccessToken(
        { userId: surgeon.user.id, role: 'flight_surgeon', isMedicalOfficer: false },
        secret,
        '1h',
      ),
    };

    mcUser = {
      ...mc,
      token: signAccessToken(
        { userId: mc.user.id, role: 'mission_control', isMedicalOfficer: false },
        secret,
        '1h',
      ),
    };
  });

  function connectClient(token: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://localhost:${port}/live`, {
        auth: { token },
        transports: ['websocket'],
      });

      sockets.push(socket);
      socket.on('hello', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  }

  it('delivers inbox.created event to flight_surgeon with full clinical notes and to mission_control with redactions', async () => {
    const surgeonSocket = await connectClient(surgeonUser.token);
    const mcSocket = await connectClient(mcUser.token);

    const surgeonEvents: Envelope[] = [];
    const mcEvents: Envelope[] = [];

    surgeonSocket.on('event', (env: Envelope) => {
      if (env.type.startsWith('inbox.')) surgeonEvents.push(env);
    });

    mcSocket.on('event', (env: Envelope) => {
      if (env.type.startsWith('inbox.')) mcEvents.push(env);
    });

    // Create a fused alert doc
    const alert = await FusedAlert.create({
      crew_id: crewProfileId,
      hazard: 'respiratory',
      group_key: `${crewProfileId}:respiratory`,
      is_unresolved: true,
      status: 'open',
      condition: 'active',
      severity: 'critical',
      peak_severity: 'critical',
      priority_score: 90,
      priority_key: 1090,
      title: 'Respiratory Emergency',
      summary: 'SpO2 critical',
      explanation: 'Hypoxia detected',
      sources: ['rule'],
      metrics: ['spo2'],
      members: [],
      member_count_total: 1,
      dropped_members: 0,
      mission_mode: 'moon',
      raised_at: '2026-10-18T11:00:00.000Z',
      last_activity_at: '2026-10-18T11:00:00.000Z',
      snoozed_until: '2026-10-18T11:10:00.000Z',
      snooze_reason: 'Clinical observation',
      resolution_note: 'Resolved via O2 mask',
      timeline: [
        {
          at: '2026-10-18T11:00:00.000Z',
          type: 'created',
          actor_id: 'system',
          from_status: 'open',
          to_status: 'open',
          note: 'CO2 elevated',
        },
      ],
      version: 1,
    });

    // Publish through inbox publisher
    await inboxPublisher.publishInboxEvent('inbox.raised', alert, 'req-live-1');

    // Wait briefly for delivery
    await new Promise((r) => setTimeout(r, 200));

    expect(surgeonEvents.length).toBeGreaterThanOrEqual(1);
    expect(mcEvents.length).toBeGreaterThanOrEqual(1);

    interface InboxLivePayload {
      snooze_reason?: string;
      resolution_note?: string;
      timeline: Array<{ note?: string }>;
    }

    const surgeonPayload = surgeonEvents[0]!.payload as unknown as InboxLivePayload;
    const mcPayload = mcEvents[0]!.payload as unknown as InboxLivePayload;

    // Flight surgeon sees full notes
    expect(surgeonPayload.snooze_reason).toBe('Clinical observation');
    expect(surgeonPayload.resolution_note).toBe('Resolved via O2 mask');
    expect(surgeonPayload.timeline[0]?.note).toBe('CO2 elevated');

    // Mission control has clinical notes redacted
    expect(mcPayload.snooze_reason).toBeUndefined();
    expect(mcPayload.resolution_note).toBeUndefined();
    expect(mcPayload.timeline[0]?.note).toBeUndefined();

    surgeonSocket.disconnect();
    mcSocket.disconnect();
  });
});
