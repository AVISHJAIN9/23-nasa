import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { parseConfig } from '../core/config.js';
import { connectMongo, disconnectMongo } from '../core/db.js';
import { CrewProfile } from '../models/CrewProfile.js';
import { ensureReadingsCollection } from '../models/Reading.js';
import { KNOWN_METRIC_NAMES } from '../telemetry/metrics.js';

interface BenchMetrics {
  totalReadings: number;
  totalBatches: number;
  errorCount: number;
  latenciesMs: number[];
  startTimeMs: number;
  endTimeMs: number;
}

function calculatePercentile(latencies: number[], p: number): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return Number((sorted[Math.max(0, index)] ?? 0).toFixed(2));
}

async function runBenchmark(): Promise<void> {
  const targetUrl = process.env['BENCH_TARGET_URL'];
  const ingestKey =
    process.env['ASTRO_INGEST_API_KEY'] || 'bench_test_insecure_ingest_key_32_chars!';

  let httpServer: HttpServer | null = null;
  let mongoServer: MongoMemoryServer | null = null;
  let baseUrl = targetUrl;
  let crewIds: string[] = [];

  console.log('====================================================');
  console.log('🚀 AstroCare Telemetry Ingestion Benchmark (F013)');
  console.log('====================================================');

  if (!baseUrl) {
    console.log(
      'ℹ️  No BENCH_TARGET_URL provided. Spinning up local in-memory benchmark harness...',
    );
    mongoServer = await MongoMemoryServer.create({
      binary: { version: '7.0.14' },
    });
    const mongoUri = mongoServer.getUri();
    await connectMongo(mongoUri);
    await ensureReadingsCollection(0);

    const config = parseConfig({
      ASTRO_ENV: 'test',
      ASTRO_INGEST_API_KEY: ingestKey,
      ASTRO_MONGODB_URI: mongoUri,
      ASTRO_TELEMETRY_MAX_BATCH: '500',
      ASTRO_EVENT_BUS_DRIVER: 'memory',
      ASTRO_RATE_LIMIT_ENABLED: 'false',
    });

    const app = createApp(config);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer!.listen(0, () => resolve());
    });
    const port = (httpServer.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`✅ Local test server running on ${baseUrl}`);

    // Seed 6 simulated crews
    console.log('🌱 Seeding 6 simulated crew profiles...');
    for (let i = 1; i <= 6; i++) {
      const crew = await CrewProfile.create({
        callsign: `CREW-BENCH-${i}`,
        age: 30 + i,
        sex: i % 2 === 0 ? 'female' : 'male',
        height_cm: 175,
        weight_kg: 72,
        medical_history: [],
        baseline: {},
        baseline_status: 'pending',
        is_synthetic: true,
      });
      crewIds.push(crew._id.toString());
    }
  } else {
    console.log(`Connecting to existing server at: ${baseUrl}`);
    crewIds = Array.from({ length: 6 }, () => new Types.ObjectId().toString());
  }

  const endpoint = `${baseUrl}/v1/telemetry`;

  function generateBatch(batchSize: number, batchNum: number, startTsMs: number) {
    const readings = [];
    for (let i = 0; i < batchSize; i++) {
      const crewId = crewIds[i % crewIds.length]!;
      const metric = KNOWN_METRIC_NAMES[i % KNOWN_METRIC_NAMES.length]!;
      readings.push({
        crew_id: crewId,
        metric,
        value: 70 + (i % 20),
        timestamp: new Date(startTsMs + batchNum * 1000 + i * 10).toISOString(),
        source: 'simulated',
      });
    }
    return {
      batch_id: `bench-${batchNum}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      readings,
    };
  }

  // Phase 1: 1 Hz for 10 s (Warm-up / Baseline)
  console.log('\n--- Phase 1: 1 Hz Telemetry Cadence (100 readings/batch for 10 s) ---');
  const phase1Stats: BenchMetrics = {
    totalReadings: 0,
    totalBatches: 0,
    errorCount: 0,
    latenciesMs: [],
    startTimeMs: Date.now(),
    endTimeMs: 0,
  };

  const p1Start = Date.now();
  for (let s = 0; s < 10; s++) {
    const batch = generateBatch(100, s, p1Start);
    const reqStart = performance.now();
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ingest-Key': ingestKey,
        },
        body: JSON.stringify(batch),
      });
      const duration = performance.now() - reqStart;
      phase1Stats.latenciesMs.push(duration);
      if (res.ok) {
        phase1Stats.totalReadings += 100;
        phase1Stats.totalBatches += 1;
      } else {
        phase1Stats.errorCount += 1;
      }
    } catch {
      phase1Stats.errorCount += 1;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  phase1Stats.endTimeMs = Date.now();

  const p1DurationS = (phase1Stats.endTimeMs - phase1Stats.startTimeMs) / 1000;
  console.log(
    `Phase 1 complete: ${phase1Stats.totalReadings} readings in ${p1DurationS.toFixed(1)} s`,
  );
  console.log(`Phase 1 Rate: ${(phase1Stats.totalReadings / p1DurationS).toFixed(1)} readings/s`);
  console.log(
    `Phase 1 Latency: p50 = ${calculatePercentile(phase1Stats.latenciesMs, 50)} ms, p95 = ${calculatePercentile(phase1Stats.latenciesMs, 95)} ms`,
  );

  // Phase 2: High Throughput (>= 1,000 readings/s sustained for 10 s)
  console.log(
    '\n--- Phase 2: High-Throughput Sustained Ingestion (Target: >= 1,000 readings/s for 10 s) ---',
  );
  const phase2Stats: BenchMetrics = {
    totalReadings: 0,
    totalBatches: 0,
    errorCount: 0,
    latenciesMs: [],
    startTimeMs: Date.now(),
    endTimeMs: 0,
  };

  const p2Start = Date.now();
  const testDurationMs = 10_000;
  let batchIndex = 0;

  while (Date.now() - p2Start < testDurationMs) {
    // Send 12 concurrent batches of 100 readings = 1,200 readings per round
    const roundPromises = Array.from({ length: 12 }, async () => {
      const batch = generateBatch(100, ++batchIndex, p2Start);
      const reqStart = performance.now();
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Ingest-Key': ingestKey,
          },
          body: JSON.stringify(batch),
        });
        const duration = performance.now() - reqStart;
        phase2Stats.latenciesMs.push(duration);
        if (res.ok) {
          phase2Stats.totalReadings += 100;
          phase2Stats.totalBatches += 1;
        } else {
          phase2Stats.errorCount += 1;
        }
      } catch {
        phase2Stats.errorCount += 1;
      }
    });

    await Promise.all(roundPromises);
    // Yield briefly to event loop
    await new Promise((r) => setTimeout(r, 5));
  }

  phase2Stats.endTimeMs = Date.now();
  const p2DurationS = (phase2Stats.endTimeMs - phase2Stats.startTimeMs) / 1000;
  const sustainedThroughput = phase2Stats.totalReadings / p2DurationS;

  console.log('\n====================================================');
  console.log('📊 BENCHMARK RESULTS');
  console.log('====================================================');
  console.log(`⏱️  Duration:           ${p2DurationS.toFixed(2)} s`);
  console.log(`📦 Batches Processed:  ${phase2Stats.totalBatches}`);
  console.log(`📈 Readings Ingested:  ${phase2Stats.totalReadings}`);
  console.log(`🚀 Sustained Rate:     ${sustainedThroughput.toFixed(1)} readings/s`);
  console.log(`⚡ p50 Latency:        ${calculatePercentile(phase2Stats.latenciesMs, 50)} ms`);
  console.log(`⚡ p95 Latency:        ${calculatePercentile(phase2Stats.latenciesMs, 95)} ms`);
  console.log(`⚡ p99 Latency:        ${calculatePercentile(phase2Stats.latenciesMs, 99)} ms`);
  console.log(`❌ Errors:             ${phase2Stats.errorCount}`);
  console.log('====================================================');

  if (sustainedThroughput >= 1000) {
    console.log('🎯 SUCCESS: Target of >= 1,000 readings/s achieved!');
  } else {
    console.warn(`⚠️ Target not reached: ${sustainedThroughput.toFixed(1)} < 1000 readings/s`);
  }

  // Allow in-flight operations to complete before closing database
  await new Promise((r) => setTimeout(r, 500));

  // Teardown
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    await disconnectMongo();
    if (mongoServer) {
      await mongoServer.stop();
    }
  }
}

runBenchmark()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Benchmark crashed with fatal error:', err);
    process.exit(1);
  });
