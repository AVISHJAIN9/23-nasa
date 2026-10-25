import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../app.js';
import { parseConfig } from '../core/config.js';
import { signAccessToken } from '../core/tokens.js';
import { createSocketServer } from '../realtime/socket.js';
import { MemoryEventBus } from '../bus/memoryEventBus.js';
import { type Envelope } from '../bus/eventTypes.js';
import { CrewProfile } from '../models/CrewProfile.js';
import { User } from '../models/User.js';
import { InMemoryQualityStateStore } from '../telemetry/qualityState.js';
import { InMemoryTelemetryPublisher } from '../telemetry/publisher.js';

interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  missed: number;
  duplicates: number;
}

function calculateStats(latencies: number[], totalExpected: number): LatencyStats {
  latencies.sort((a, b) => a - b);
  const count = latencies.length;
  const missed = totalExpected - count;
  const min = count > 0 ? latencies[0]! : 0;
  const max = count > 0 ? latencies[count - 1]! : 0;
  const sum = latencies.reduce((acc, v) => acc + v, 0);
  const mean = count > 0 ? sum / count : 0;

  const getPercentile = (p: number) => {
    if (count === 0) return 0;
    const idx = Math.min(Math.floor((p / 100) * count), count - 1);
    return latencies[idx]!;
  };

  return {
    count,
    min,
    max,
    mean,
    p50: getPercentile(50),
    p95: getPercentile(95),
    p99: getPercentile(99),
    missed,
    duplicates: 0,
  };
}

async function runBench(): Promise<void> {
  const numClients = parseInt(process.env['BENCH_CLIENTS'] || '50', 10);
  console.log(`\n======================================================`);
  console.log(`⚡ AstroCare Live Dashboard Benchmark (F118 / F063)`);
  console.log(`🎯 Connecting ${numClients} clients (mixed astronaut, surgeon, ground, admin)`);
  console.log(`======================================================\n`);

  // Start in-memory mongo and test server
  const mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const secret = 'bench_secret_key_minimum_32_characters_long!';
  const settings = parseConfig({
    ASTRO_ENV: 'test',
    ASTRO_PORT: '4099',
    ASTRO_JWT_ACCESS_SECRET: secret,
    ASTRO_EVENT_BUS_DRIVER: 'memory',
  });

  const eventBus = new MemoryEventBus();
  const qualityStateStore = new InMemoryQualityStateStore();
  const publisher = new InMemoryTelemetryPublisher();
  const app = createApp({ settings, eventBus });
  const httpServer = createServer(app);
  createSocketServer(httpServer, { settings, eventBus, qualityStateStore, publisher });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve());
  });
  const port = (httpServer.address() as AddressInfo).port;

  // Create declaring astronaut profile
  const profile = await CrewProfile.create({
    callsign: 'PIONEER-BENCH',
    age: 33,
    sex: 'female',
    height_cm: 170,
    weight_kg: 65,
    medical_history: [],
    baseline: {},
    baseline_status: 'pending',
    is_synthetic: false,
  });

  const declaringUser = await User.create({
    email: 'declaring.astronaut@astrocare.nasa.gov',
    display_name: 'Lead Astronaut',
    role: 'astronaut',
    crew_profile_id: profile._id,
    password_hash: 'hash',
  });

  // Generate tokens for N clients
  const roles = ['astronaut', 'flight_surgeon', 'mission_control', 'admin'] as const;
  const clientSockets: ClientSocket[] = [];
  const clientLatencies: number[] = [];
  let duplicatesCount = 0;

  console.log(`Connecting ${numClients} Socket.IO clients to http://localhost:${port}/live ...`);
  const connectionStart = performance.now();

  const connectPromises = Array.from({ length: numClients }).map(async (_, idx) => {
    const role = roles[idx % roles.length]!;
    const token = signAccessToken(
      { userId: `bench-user-${idx}`, role, isMedicalOfficer: idx % 10 === 0 },
      secret,
      '15m',
    );

    const socket = ioClient(`http://localhost:${port}/live`, {
      transports: ['websocket'],
      auth: { token },
      autoConnect: false,
      reconnection: false,
    });
    clientSockets.push(socket);

    const connected = new Promise<void>((resolve) => {
      socket.on('hello', () => resolve());
    });
    socket.connect();
    return connected;
  });

  await Promise.all(connectPromises);
  const connectElapsed = (performance.now() - connectionStart).toFixed(1);
  console.log(`✅ All ${numClients} clients connected in ${connectElapsed} ms.\n`);

  // Target event identifier
  const targetUid = randomUUID();
  let startPublishTime = 0;

  const receiptPromises = clientSockets.map((socket) => {
    const seenUids = new Set<string>();
    return new Promise<void>((resolve) => {
      socket.on('event', (e: Envelope) => {
        if (e.uid === targetUid) {
          if (seenUids.has(e.uid)) {
            duplicatesCount += 1;
          } else {
            seenUids.add(e.uid);
            const latency = performance.now() - startPublishTime;
            clientLatencies.push(latency);
            resolve();
          }
        }
      });
    });
  });

  console.log(`Publishing Emergency Declaration event across all roles...`);
  startPublishTime = performance.now();

  await eventBus.publish({
    uid: targetUid,
    topic: 'emergency',
    type: 'emergency.declared',
    severity: 'critical',
    audience: 'all',
    payload: {
      type: 'cardiac',
      note: 'Critical cardiac arrhythmia in bench run',
      declared_by: String(declaringUser._id),
    },
  });

  await Promise.all(receiptPromises);
  const totalDuration = performance.now() - startPublishTime;

  const stats = calculateStats(clientLatencies, numClients);
  stats.duplicates = duplicatesCount;

  console.log(`\n📊 BENCHMARK RESULTS:`);
  console.log(`------------------------------------------------------`);
  console.log(`Total Clients Connected:   ${numClients}`);
  console.log(`Delivered Events:          ${stats.count} / ${numClients}`);
  console.log(`Missed Events:             ${stats.missed}`);
  console.log(`Duplicate Deliveries:      ${stats.duplicates}`);
  console.log(`Total Wall-Clock Time:     ${totalDuration.toFixed(2)} ms`);
  console.log(`Delivery Latency (p50):    ${stats.p50.toFixed(2)} ms`);
  console.log(`Delivery Latency (p95):    ${stats.p95.toFixed(2)} ms`);
  console.log(`Delivery Latency (p99):    ${stats.p99.toFixed(2)} ms`);
  console.log(`Min Latency:               ${stats.min.toFixed(2)} ms`);
  console.log(`Max Latency:               ${stats.max.toFixed(2)} ms`);
  console.log(`------------------------------------------------------`);
  console.log(
    `Status:                    ${stats.max < 3000 ? 'PASSED (< 3.0s SLA) ✅' : 'FAILED ❌'}\n`,
  );

  // Cleanup
  for (const s of clientSockets) {
    s.disconnect();
  }
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await mongoose.disconnect();
  await mongoServer.stop();
  process.exit(0);
}

runBench().catch((err) => {
  console.error('Bench script failed:', err);
  process.exit(1);
});
