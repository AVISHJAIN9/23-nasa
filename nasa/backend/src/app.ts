import express, { type Express } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { loadConfig, type Settings } from './core/config.js';
import { FlagService } from './core/flags.js';
import { defaultReadinessRegistry, type ReadinessRegistry } from './core/readiness.js';
import { type AuditWriter, MongoAuditWriter } from './core/audit.js';
import { generateOpenApiDocument } from './core/openapi.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFound.js';
import { healthRouter } from './routes/health.js';
import { createV1Router } from './routes/v1/index.js';

import type { QualityStateStore } from './telemetry/qualityState.js';
import type { TelemetryPublisher } from './telemetry/publisher.js';
import type { IdempotencyStore } from './telemetry/idempotency.js';
import type { CrewIdCache } from './telemetry/ingestService.js';
import type { EventBus } from './bus/eventBus.js';
import { MemoryEventBus } from './bus/memoryEventBus.js';
import { RedisEventBus } from './bus/redisEventBus.js';
import type { DeliveryPolicy } from './bus/deliveryPolicy.js';
import type { AlertPublisher } from './alerts/alertPublisher.js';
import type { TelemetryBridge } from './bus/telemetryBridge.js';
import { type Clock, SystemClock } from './core/clock.js';
import { type FusionRepository, MongoFusionRepository } from './fusion/fusionRepository.js';
import { InboxPublisher } from './fusion/inboxPublisher.js';
import { FusionEngine } from './fusion/fusionEngine.js';
import { SnoozeSweeper } from './fusion/snoozeSweeper.js';
import { InboxService } from './fusion/inboxService.js';
import { MissionClockService } from './mission/missionClock.js';
import type { CommsDelayEmulator } from './link/commsDelayEmulator.js';
import type { StoreAndForwardQueue } from './link/storeAndForward.js';
import type { ProtocolService } from './protocols/protocolService.js';
import type { RateLimiter } from './core/rateLimiter.js';
import {
  type PrometheusRegistry,
  defaultMetricsRegistry,
  createMetricsMiddleware,
} from './core/metrics.js';

export interface AppDependencies {
  settings?: Settings;
  flagService?: FlagService;
  readinessRegistry?: ReadinessRegistry;
  auditWriter?: AuditWriter;
  rateLimiter?: RateLimiter;
  metricsRegistry?: PrometheusRegistry;
  customRouter?: { path: string; router: express.Router };
  qualityStateStore?: QualityStateStore;
  publisher?: TelemetryPublisher;
  idempotencyStore?: IdempotencyStore;
  crewIdCache?: CrewIdCache;
  eventBus?: EventBus;
  deliveryPolicy?: DeliveryPolicy;
  alertPublisher?: AlertPublisher;
  telemetryBridge?: TelemetryBridge;
  clock?: Clock;
  fusionRepository?: FusionRepository;
  fusionEngine?: FusionEngine;
  snoozeSweeper?: SnoozeSweeper;
  inboxService?: InboxService;
  inboxPublisher?: InboxPublisher;
  missionClock?: MissionClockService;
  commsDelayEmulator?: CommsDelayEmulator;
  dtnQueue?: StoreAndForwardQueue;
  protocolService?: ProtocolService;
}

/**
 * Application factory. Builds and configures the Express application.
 * Accepts injected settings and services for deterministic test isolation.
 */
export function createApp(dependenciesOrSettings?: Settings | AppDependencies): Express {
  const deps: AppDependencies =
    dependenciesOrSettings && 'env' in dependenciesOrSettings
      ? { settings: dependenciesOrSettings }
      : (dependenciesOrSettings as AppDependencies) || {};

  const settings = deps.settings ?? loadConfig();
  const flagService = deps.flagService ?? new FlagService();
  const readinessRegistry = deps.readinessRegistry ?? defaultReadinessRegistry;
  const auditWriter = deps.auditWriter ?? new MongoAuditWriter();

  const eventBus =
    deps.eventBus ??
    (settings.event_bus_driver === 'memory' || settings.env === 'test'
      ? new MemoryEventBus({
          maxLen: settings.bus_stream_maxlen,
          missionMode: settings.mission_mode,
        })
      : new RedisEventBus({
          redisUrl: settings.redis_url,
          keyPrefix: settings.redis_key_prefix,
          streamMaxlen: settings.bus_stream_maxlen,
          outboxMax: settings.bus_outbox_max,
          missionMode: settings.mission_mode,
        }));

  readinessRegistry.registerCheck('event_bus', () => {
    const info = eventBus.info();
    if (settings.redis_required && !info.connected) {
      return {
        ok: false,
        message: 'Redis required in production but disconnected',
      };
    }
    return {
      ok: true,
      message: info.degraded ? 'Event bus in degraded mode' : 'Event bus ok',
    };
  });

  // Part 2d: Clock, Fusion, Sweeper, Inbox
  const clock = deps.clock ?? new SystemClock();
  const fusionRepository = deps.fusionRepository ?? new MongoFusionRepository();
  const inboxPublisher = deps.inboxPublisher ?? new InboxPublisher(eventBus);

  const snoozeLimits = {
    maxWarningMin: settings.fusion_snooze_max_warning_min,
    maxWatchMin: settings.fusion_snooze_max_watch_min,
  };

  const fusionEngine =
    deps.fusionEngine ??
    new FusionEngine(
      fusionRepository,
      inboxPublisher,
      clock,
      {
        enabled: settings.fusion_enabled,
        minConfidence: settings.fusion_ml_min_confidence,
        dismissSuppressS: settings.fusion_dismiss_suppress_s,
        updateCoalesceS: settings.fusion_update_coalesce_s,
        maxMembers: settings.fusion_max_members,
        timelineMax: settings.fusion_timeline_max,
        reconcileOnStart: settings.fusion_reconcile_on_start,
      },
      deps.alertPublisher,
    );

  const snoozeSweeper =
    deps.snoozeSweeper ??
    new SnoozeSweeper(fusionRepository, inboxPublisher, clock, settings.fusion_sweep_s);

  const inboxService =
    deps.inboxService ??
    new InboxService({
      repository: fusionRepository,
      inboxPublisher,
      auditWriter,
      clock,
      dismissSuppressS: settings.fusion_dismiss_suppress_s,
      snoozeLimits,
    });

  readinessRegistry.registerCheck('fusion_engine', async () => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return {
          ok: true,
          message: 'Fusion engine ready (database not connected)',
        };
      }
      const readiness = await fusionEngine.getReadiness();
      return {
        ok: true,
        message: 'Fusion engine ready',
        details: readiness,
      };
    } catch {
      return {
        ok: true,
        message: 'Fusion engine ready (metrics unavailable)',
      };
    }
  });

  const missionClock =
    deps.missionClock ??
    new MissionClockService({
      clock,
      settings,
      eventBus,
      auditWriter,
      getMissionMode: () => settings.mission_mode,
    });

  readinessRegistry.registerCheck('mission_clock', () => {
    return {
      ok: true,
      message: 'Mission clock ready',
      details: missionClock.getStatus(),
    };
  });

  const app = express();

  // Store in app.locals for dependency access in middlewares/controllers
  app.locals['settings'] = settings;
  app.locals['flagService'] = flagService;
  app.locals['readinessRegistry'] = readinessRegistry;
  app.locals['auditWriter'] = auditWriter;
  app.locals['eventBus'] = eventBus;
  app.locals['clock'] = clock;
  app.locals['fusionEngine'] = fusionEngine;
  app.locals['snoozeSweeper'] = snoozeSweeper;
  app.locals['inboxService'] = inboxService;
  app.locals['missionClock'] = missionClock;
  if (deps.deliveryPolicy) app.locals['deliveryPolicy'] = deps.deliveryPolicy;
  if (deps.qualityStateStore) app.locals['qualityStateStore'] = deps.qualityStateStore;
  if (deps.publisher) app.locals['publisher'] = deps.publisher;
  if (deps.idempotencyStore) app.locals['idempotencyStore'] = deps.idempotencyStore;
  if (deps.crewIdCache) app.locals['crewIdCache'] = deps.crewIdCache;

  // 1. Correlation and Request ID tracking
  app.use(requestIdMiddleware);

  // 1b. Prometheus request metrics collection
  const metricsRegistry = deps.metricsRegistry ?? defaultMetricsRegistry;
  app.use(createMetricsMiddleware(metricsRegistry));

  // 2. CORS security (explicit origin list required for credentialed/cookie requests)
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        const isAllowed = settings.cors_origins.includes(origin);
        if (isAllowed) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
      exposedHeaders: ['X-Request-ID'],
    }),
  );

  // 3. Security headers (relaxed CSP specifically so Swagger UI assets can render in /docs)
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  // 4. JSON body parser with strict 1mb size limit
  app.use(express.json({ limit: '1mb' }));

  // 5. Cookie parser for refresh token exchange
  app.use(cookieParser());

  // 6. Root & Liveness probe (outside /v1)
  app.use('/', healthRouter);

  // 7. Prometheus /metrics scrape endpoint
  app.get('/metrics', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metricsRegistry.exportMetrics());
  });

  // 8. OpenAPI Documentation
  const openApiDoc = generateOpenApiDocument(undefined, settings.app_version);

  // OpenAPI JSON contract
  app.get('/v1/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(openApiDoc);
  });

  // Swagger UI interactive documentation
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));

  // 9. Mount Versioned Business Routes
  app.use(
    '/v1',
    createV1Router({
      settings,
      flagService,
      readinessRegistry,
      auditWriter,
      rateLimiter: deps.rateLimiter,
      qualityStateStore: deps.qualityStateStore,
      publisher: deps.publisher,
      idempotencyStore: deps.idempotencyStore,
      crewIdCache: deps.crewIdCache,
      eventBus,
      deliveryPolicy: deps.deliveryPolicy,
      fusionEngine,
      inboxService,
      missionClock,
      clock,
      commsDelayEmulator: deps.commsDelayEmulator,
      dtnQueue: deps.dtnQueue,
      protocolService: deps.protocolService,
      metricsRegistry,
    }),
  );

  // Optional custom router mount (used for test-specific route verification)
  if (deps.customRouter) {
    app.use(deps.customRouter.path, deps.customRouter.router);
  }

  // 9. 404 handler for unmatched routes
  app.use(notFoundHandler);

  // 10. Centralized Error Handler
  app.use(errorHandler);

  return app;
}
