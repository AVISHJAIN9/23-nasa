import { createServer } from 'node:http';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { connectMongo, disconnectMongo } from './core/db.js';
import { ensureReadingsCollection } from './models/Reading.js';
import { InMemoryQualityStateStore } from './telemetry/qualityState.js';
import { InMemoryTelemetryPublisher } from './telemetry/publisher.js';
import { MongoIdempotencyStore } from './telemetry/idempotency.js';
import { InMemoryCrewIdCache } from './telemetry/ingestService.js';
import { createSocketServer } from './realtime/socket.js';
import { createApp } from './app.js';
import { type EventBus } from './bus/eventBus.js';
import { MemoryEventBus } from './bus/memoryEventBus.js';
import { RedisEventBus } from './bus/redisEventBus.js';
import { NoDelayPolicy } from './bus/deliveryPolicy.js';
import { BusAlertPublisher } from './bus/busAlertPublisher.js';
import { TelemetryBridge } from './bus/telemetryBridge.js';
import { sanitizeRedisUrl, createRedisClient } from './bus/redisClient.js';
import { type RateLimiter, RedisRateLimiter, MemoryRateLimiter } from './core/rateLimiter.js';
import { Redis } from 'ioredis';

async function main(): Promise<void> {
  let settings;
  try {
    settings = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Connect to MongoDB database
  try {
    await connectMongo(settings.mongodb_uri);
  } catch (err) {
    logger.fatal({ err }, 'Failed to initialize database connection. Halting startup.');
    process.exit(1);
  }

  // Initialize and verify time-series collection for telemetry readings
  try {
    await ensureReadingsCollection(settings.telemetry_retention_days);
  } catch (err) {
    logger.fatal({ err }, 'Failed to initialize time-series readings collection. Halting startup.');
    process.exit(1);
  }

  // Initialize EventBus
  let eventBus: EventBus;
  if (settings.event_bus_driver === 'memory') {
    logger.info('Initializing In-Memory EventBus');
    eventBus = new MemoryEventBus({
      maxLen: settings.bus_stream_maxlen,
      missionMode: settings.mission_mode,
    });
  } else {
    const sanitizedUrl = sanitizeRedisUrl(settings.redis_url);
    logger.info({ redisUrl: sanitizedUrl }, 'Initializing Redis EventBus');

    // Test connectivity if Redis is strictly required (e.g. prod)
    if (settings.redis_required) {
      try {
        const pingClient = new Redis(settings.redis_url, {
          connectTimeout: 3000,
          maxRetriesPerRequest: 1,
          lazyConnect: true,
        });
        await pingClient.connect();
        await pingClient.ping();
        await pingClient.quit();
      } catch (err) {
        logger.fatal(
          { err: (err as Error).message, redisUrl: sanitizedUrl },
          'ASTRO_REDIS_REQUIRED is enabled but Redis connection failed. Halting startup.',
        );
        process.exit(1);
      }
    }

    eventBus = new RedisEventBus({
      redisUrl: settings.redis_url,
      keyPrefix: settings.redis_key_prefix,
      streamMaxlen: settings.bus_stream_maxlen,
      outboxMax: settings.bus_outbox_max,
      missionMode: settings.mission_mode,
    });
  }

  // Initialize distributed or in-memory rate limiter
  let rateLimiter: RateLimiter;
  if (settings.event_bus_driver === 'redis') {
    const rateLimitRedis = createRedisClient(settings.redis_url, { clientName: 'bus-ratelimit' });
    rateLimiter = new RedisRateLimiter({
      redis: rateLimitRedis,
      keyPrefix: `${settings.redis_key_prefix}ratelimit:`,
    });
  } else {
    rateLimiter = new MemoryRateLimiter();
  }

  // Initialize singleton stores, publishers, policies, and bridge
  const qualityStateStore = new InMemoryQualityStateStore();
  const publisher = new InMemoryTelemetryPublisher();
  const idempotencyStore = new MongoIdempotencyStore();
  const crewIdCache = new InMemoryCrewIdCache();
  const deliveryPolicy = new NoDelayPolicy();
  const alertPublisher = new BusAlertPublisher(eventBus);

  const telemetryBridge = new TelemetryBridge(publisher, eventBus, {
    coalesceMs: settings.live_telemetry_coalesce_ms,
  });
  telemetryBridge.start();

  // Create Express application (pure HTTP)
  const app = createApp({
    settings,
    rateLimiter,
    qualityStateStore,
    publisher,
    idempotencyStore,
    crewIdCache,
    eventBus,
    deliveryPolicy,
    alertPublisher,
    telemetryBridge,
  });

  // Attach HTTP server and Socket.IO realtime layer
  const httpServer = createServer(app);
  const io = createSocketServer(httpServer, {
    settings,
    qualityStateStore,
    publisher,
    idempotencyStore,
    crewIdCache,
    eventBus,
    deliveryPolicy,
  });

  httpServer.listen(settings.port, '0.0.0.0', () => {
    logger.info(
      {
        port: settings.port,
        env: settings.env,
        mission_mode: settings.mission_mode,
        version: settings.app_version,
      },
      `🚀 AstroCare Backend running on http://localhost:${settings.port}`,
    );
    logger.info(`📖 OpenAPI JSON available at http://localhost:${settings.port}/v1/openapi.json`);
    logger.info(`📚 Swagger UI documentation available at http://localhost:${settings.port}/docs`);
    logger.info(`⚡ Socket.IO /ingest and /live namespaces ready for realtime streaming`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    telemetryBridge.stop();
    io.close(() => {
      logger.info('Socket.IO connections closed.');
    });
    httpServer.close(async () => {
      logger.info('HTTP server closed.');
      await eventBus.close();
      await disconnectMongo();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup crash.');
  process.exit(1);
});
