import { Router, type Request, type Response, type NextFunction } from 'express';
import { registerRoute } from '../../core/openapi.js';
import { ServiceUnavailableError } from '../../core/errors.js';
import {
  ReadinessResponseSchema,
  defaultReadinessRegistry,
  type ReadinessRegistry,
} from '../../core/readiness.js';
import type { Settings } from '../../core/config.js';
import type { FlagService } from '../../core/flags.js';

export interface HealthRouterOptions {
  settings: Settings;
  flagService: FlagService;
  readinessRegistry?: ReadinessRegistry;
}

/**
 * Creates the /v1/health router with readiness probe.
 */
export function createV1HealthRouter(options: HealthRouterOptions): Router {
  const router = Router();
  const registry = options.readinessRegistry ?? defaultReadinessRegistry;

  registerRoute({
    method: 'get',
    path: '/v1/health/ready',
    tags: ['Health'],
    summary: 'Subsystem readiness probe',
    description:
      'Executes all registered health checks (MongoDB, Redis, ML sidecars) and returns system state.',
    successResponse: {
      status: 200,
      description: 'System is healthy and ready to accept traffic',
      schema: ReadinessResponseSchema,
    },
  });

  router.get('/ready', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { ok, results } = await registry.runChecks();
      const flagSummary = await options.flagService.all();

      if (!ok) {
        const failedChecks = Object.entries(results)
          .filter(([_, result]) => !result.ok)
          .map(([name, result]) => ({
            field: `checks.${name}`,
            issue: result.message || 'Subsystem check failed',
          }));

        throw new ServiceUnavailableError(
          'Readiness check failed: one or more subsystems are not ready',
          failedChecks,
        );
      }

      res.status(200).json({
        status: 'ok',
        version: options.settings.app_version,
        mission_mode: options.settings.mission_mode,
        flags: flagSummary,
        checks: results,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
