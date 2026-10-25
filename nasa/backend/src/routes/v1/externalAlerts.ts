import { Router, type Request, type Response, type NextFunction } from 'express';
import { registerRoute } from '../../core/openapi.js';
import { validate } from '../../middleware/validate.js';
import { timingSafeCompare } from '../../telemetry/ingestAuth.js';
import { UnauthenticatedError } from '../../core/errors.js';
import { type Settings } from '../../core/config.js';
import { type FusionEngine } from '../../fusion/fusionEngine.js';
import {
  ExternalAlertsBatchBodySchema,
  ExternalAlertsResponseSchema,
  type ExternalAlertsBatchBody,
} from '../../schemas/externalAlerts.js';
import { processExternalAlertsBatch } from '../../fusion/externalIntake.js';

export interface ExternalAlertsRouterDeps {
  settings: Settings;
  fusionEngine: FusionEngine;
}

export function createV1ExternalAlertsRouter(deps: ExternalAlertsRouterDeps): Router {
  const router = Router();

  // POST /v1/alerts/external
  registerRoute({
    method: 'post',
    path: '/v1/alerts/external',
    tags: ['Alerts', 'Fusion'],
    summary: 'Ingest external anomaly/risk alerts from ML Python services',
    description:
      'Service-key authenticated intake endpoint for ML anomaly detectors and risk predictors. Performs validation, deduplication, and feeds alerts into the fusion engine.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: ExternalAlertsBatchBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 200,
      description: 'Batch processed with accepted and per-item rejected results',
      schema: ExternalAlertsResponseSchema,
    },
  });

  function requireMlApiKey(settings: Settings) {
    return (req: Request, _res: Response, next: NextFunction) => {
      const mlKeyHeader = req.headers['x-ml-key'];
      const mlKey =
        typeof mlKeyHeader === 'string'
          ? mlKeyHeader
          : Array.isArray(mlKeyHeader)
            ? (mlKeyHeader[0] ?? '')
            : '';

      if (!mlKey || !timingSafeCompare(mlKey, settings.ml_api_key)) {
        throw new UnauthenticatedError(
          'Invalid or missing X-ML-Key header. Provide a valid service key for ML intake.',
        );
      }
      next();
    };
  }

  router.post(
    '/alerts/external',
    requireMlApiKey(deps.settings),
    validate({ body: ExternalAlertsBatchBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (res.locals.validated?.body ?? req.body) as ExternalAlertsBatchBody;
        const result = await processExternalAlertsBatch(
          body,
          deps.fusionEngine,
          deps.settings.mission_mode,
        );

        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
