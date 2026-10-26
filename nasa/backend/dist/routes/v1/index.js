import { Router } from 'express';
import { z } from 'zod';
import { registerRoute } from '../../core/openapi.js';
import { defaultMetricsRegistry } from '../../core/metrics.js';
import { createV1HealthRouter } from './health.js';
import { createV1FlagsRouter } from './flags.js';
import { createV1AuthRouter } from './auth.js';
import { createV1UsersRouter } from './users.js';
import { createV1CrewRouter } from './crew.js';
import { createV1OnboardingRouter } from './onboarding.js';
import { createV1TelemetryRouter } from './telemetry.js';
import { MongoAuditWriter } from '../../core/audit.js';
import { InMemoryQualityStateStore } from '../../telemetry/qualityState.js';
import { InMemoryTelemetryPublisher } from '../../telemetry/publisher.js';
import { MongoIdempotencyStore } from '../../telemetry/idempotency.js';
import { InMemoryCrewIdCache } from '../../telemetry/ingestService.js';
import { createV1EmergenciesRouter } from './emergencies.js';
import { createV1EventsRouter } from './events.js';
import { createV1ExternalAlertsRouter } from './externalAlerts.js';
import { createV1InboxRouter } from './inbox.js';
import { createV1MissionRouter } from './mission.js';
import { createV1LinkRouter } from './link.js';
import { createV1ProtocolsRouter } from './protocols.js';
import { createV1AuditRouter } from './audit.js';
import { MemoryEventBus } from '../../bus/memoryEventBus.js';
import { SystemClock } from '../../core/clock.js';
import { CommsDelayEmulator } from '../../link/commsDelayEmulator.js';
import { MongoLinkStore } from '../../link/linkStore.js';
import { StoreAndForwardQueue } from '../../link/storeAndForward.js';
import { ProtocolService } from '../../protocols/protocolService.js';
import { MemoryRateLimiter, createRateLimitMiddleware, } from '../../core/rateLimiter.js';
/**
 * Aggregates all v1 API sub-routers.
 */
export function createV1Router(options) {
    const router = Router();
    const auditWriter = options.auditWriter ?? new MongoAuditWriter();
    const qualityStateStore = options.qualityStateStore ?? new InMemoryQualityStateStore();
    const publisher = options.publisher ?? new InMemoryTelemetryPublisher();
    const idempotencyStore = options.idempotencyStore ?? new MongoIdempotencyStore();
    const crewIdCache = options.crewIdCache ?? new InMemoryCrewIdCache();
    const eventBus = options.eventBus ??
        new MemoryEventBus({
            maxLen: options.settings.bus_stream_maxlen,
            missionMode: options.settings.mission_mode,
        });
    const rateLimiter = options.rateLimiter ?? new MemoryRateLimiter();
    if (options.settings.rate_limit_enabled) {
        router.use(createRateLimitMiddleware({
            limiter: rateLimiter,
            limit: options.settings.rate_limit_max_requests,
            windowSeconds: options.settings.rate_limit_window_s,
            prefix: 'v1:global',
        }));
    }
    registerRoute({
        method: 'get',
        path: '/v1/metrics',
        tags: ['Observability'],
        summary: 'Prometheus metrics scrape endpoint',
        description: 'Exposes system telemetry ingestion rates, HTTP latencies, alert states, bus lag, and deep space link metrics in Prometheus exposition format.',
        successResponse: {
            status: 200,
            description: 'Prometheus text metrics exposition',
            schema: z.string().openapi({ example: '# HELP http_requests_total ...\n' }),
        },
    });
    const metricsRegistry = options.metricsRegistry ?? defaultMetricsRegistry;
    router.get('/metrics', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(metricsRegistry.exportMetrics());
    });
    router.use('/audit', createV1AuditRouter({ auditWriter }));
    router.use('/auth', createV1AuthRouter({ settings: options.settings }));
    router.use('/users', createV1UsersRouter({ auditWriter }));
    router.use('/crew', createV1CrewRouter({ settings: options.settings }));
    router.use('/onboarding', createV1OnboardingRouter());
    router.use('/health', createV1HealthRouter(options));
    router.use('/flags', createV1FlagsRouter({ flagService: options.flagService }));
    router.use('/emergencies', createV1EmergenciesRouter({
        eventBus,
        auditWriter,
        settings: options.settings,
    }));
    router.use('/events', createV1EventsRouter({
        eventBus,
        deliveryPolicy: options.deliveryPolicy,
    }));
    router.use('/', createV1TelemetryRouter({
        settings: options.settings,
        qualityStateStore,
        publisher,
        idempotencyStore,
        crewIdCache,
    }));
    if (options.fusionEngine) {
        router.use('/', createV1ExternalAlertsRouter({
            settings: options.settings,
            fusionEngine: options.fusionEngine,
        }));
    }
    if (options.inboxService) {
        router.use('/inbox', createV1InboxRouter(options.inboxService));
    }
    if (options.missionClock) {
        router.use('/mission', createV1MissionRouter({
            missionClock: options.missionClock,
            flagService: options.flagService,
            settings: options.settings,
        }));
    }
    const clock = options.clock ?? new SystemClock();
    const emulator = options.commsDelayEmulator ??
        new CommsDelayEmulator({
            clock,
            settings: options.settings,
            linkStore: new MongoLinkStore(),
        });
    const dtnQueue = options.dtnQueue ??
        new StoreAndForwardQueue({
            clock,
            emulator,
            eventBus,
        });
    const protocolService = options.protocolService ??
        new ProtocolService({
            clock,
            emulator,
            dtnQueue,
            eventBus,
        });
    router.use('/link', createV1LinkRouter({
        settings: options.settings,
        emulator,
        dtnQueue,
    }));
    router.use('/protocols', createV1ProtocolsRouter({
        protocolService,
    }));
    return router;
}
