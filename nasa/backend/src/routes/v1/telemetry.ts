import { Router, type Request, type Response, type NextFunction } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { registerRoute } from '../../core/openapi.js';
import { authenticate, requireSelfOrRole } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import { NotFoundError } from '../../core/errors.js';
import { CrewProfile } from '../../models/CrewProfile.js';
import { Reading } from '../../models/Reading.js';
import { KNOWN_METRIC_NAMES } from '../../telemetry/metrics.js';
import {
  computePayloadHash,
  resolveIdempotencyKey,
  MongoIdempotencyStore,
} from '../../telemetry/idempotency.js';
import { resolveIngestPrincipal } from '../../telemetry/ingestAuth.js';
import { ingestBatch, type IngestDependencies } from '../../telemetry/ingestService.js';
import {
  TelemetryBatchRequestSchema,
  TelemetryBatchResponseSchema,
  LatestTelemetryResponseSchema,
  ObjectIdSchema,
  type TelemetryBatchRequest,
} from '../../schemas/telemetry.js';

export function createV1TelemetryRouter(deps: IngestDependencies): Router {
  const router = Router();
  const idempotencyStore = deps.idempotencyStore ?? new MongoIdempotencyStore();

  // 1. POST /v1/telemetry
  registerRoute({
    method: 'post',
    path: '/v1/telemetry',
    tags: ['Telemetry'],
    summary: 'Ingest vital signs telemetry batch',
    description:
      'Ingests a batch of sensor readings with quality evaluation, missing-data handling, and idempotency',
    request: {
      body: {
        content: {
          'application/json': {
            schema: TelemetryBatchRequestSchema,
          },
        },
      },
    },
    successResponse: {
      status: 200,
      description: 'Telemetry batch successfully processed and stored',
      schema: TelemetryBatchResponseSchema,
    },
  });

  router.post(
    '/telemetry',
    validate({ body: TelemetryBatchRequestSchema }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const signature = (req.header('x-telemetry-signature') ||
          req.header('x-signature') ||
          req.header('x-hmac-signature')) as string | undefined;

        const principal = await resolveIngestPrincipal(
          {
            ingestKey: (req.header('x-ingest-key') || req.headers['x-ingest-key']) as
              string | undefined,
            authHeader: req.header('authorization'),
            signature,
            payload: req.body,
          },
          deps.settings,
        );

        const body = (res.locals.validated?.body ?? req.body) as TelemetryBatchRequest;
        const headerKey = req.header('idempotency-key');
        const payloadHash = computePayloadHash(req.body);
        const idempotencyKey = resolveIdempotencyKey(headerKey, body.batch_id, payloadHash);

        const reservation = await idempotencyStore.reserve(
          principal.scope,
          idempotencyKey,
          payloadHash,
        );

        if (reservation.isReplay) {
          res.setHeader('Idempotency-Replayed', 'true');
          res.status(200).json(reservation.response);
          return;
        }

        try {
          const response = await ingestBatch(body, principal, deps);
          await idempotencyStore.complete(
            principal.scope,
            idempotencyKey,
            response as unknown as Record<string, unknown>,
          );
          res.status(200).json(response);
        } catch (err) {
          await idempotencyStore.rollback(principal.scope, idempotencyKey);
          throw err;
        }
      } catch (err) {
        next(err);
      }
    },
  );

  // 2. GET /v1/crew/:id/telemetry/latest
  registerRoute({
    method: 'get',
    path: '/v1/crew/{id}/telemetry/latest',
    tags: ['Telemetry'],
    summary: 'Get latest telemetry readings per metric',
    description:
      'Retrieves the most recent reading and latest ok reading for each metric using the time-series index',
    request: {
      params: z.object({
        id: ObjectIdSchema,
      }),
    },
    successResponse: {
      status: 200,
      description: 'Latest telemetry summary retrieved',
      schema: LatestTelemetryResponseSchema,
    },
  });

  router.get(
    '/crew/:id/telemetry/latest',
    validate({ params: z.object({ id: ObjectIdSchema }) }),
    authenticate,
    requireSelfOrRole('id', 'flight_surgeon', 'mission_control', 'admin'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const crewId = String(req.params['id']);
        const crewExists = await CrewProfile.exists({ _id: crewId });
        if (!crewExists) {
          throw new NotFoundError('Crew profile not found');
        }

        const crewObjectId = new Types.ObjectId(crewId);

        // Concurrently query the latest and latest_ok reading per registered metric
        // Guaranteed to utilize the compound index { 'meta.crew_id': 1, 'meta.metric': 1, timestamp: -1 }
        const metricQueries = KNOWN_METRIC_NAMES.map(async (metric) => {
          const [latestDoc, latestOkDoc] = await Promise.all([
            Reading.findOne({ 'meta.crew_id': crewObjectId, 'meta.metric': metric })
              .sort({ timestamp: -1 })
              .lean(),
            Reading.findOne({
              'meta.crew_id': crewObjectId,
              'meta.metric': metric,
              'quality.flag': 'ok',
            })
              .sort({ timestamp: -1 })
              .lean(),
          ]);

          const mapDoc = (doc: typeof latestDoc) => {
            if (!doc) return null;
            return {
              crew_id: doc.meta.crew_id.toString(),
              metric: doc.meta.metric,
              value: doc.value,
              unit: doc.unit,
              timestamp:
                doc.timestamp instanceof Date
                  ? doc.timestamp.toISOString()
                  : new Date(doc.timestamp).toISOString(),
              source: doc.meta.source,
              quality: {
                flag: doc.quality.flag,
                reasons: doc.quality.reasons ?? [],
              },
            };
          };

          return [metric, { latest: mapDoc(latestDoc), latest_ok: mapDoc(latestOkDoc) }] as const;
        });

        const metricResults = await Promise.all(metricQueries);
        const metricsMap = Object.fromEntries(metricResults);

        res.status(200).json({
          crew_id: crewId,
          metrics: metricsMap,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
