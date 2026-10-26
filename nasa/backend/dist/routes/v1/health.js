import { Router } from 'express';
import { registerRoute } from '../../core/openapi.js';
import { ServiceUnavailableError } from '../../core/errors.js';
import { ReadinessResponseSchema, defaultReadinessRegistry, } from '../../core/readiness.js';
/**
 * Creates the /v1/health router with readiness probe.
 */
export function createV1HealthRouter(options) {
    const router = Router();
    const registry = options.readinessRegistry ?? defaultReadinessRegistry;
    registerRoute({
        method: 'get',
        path: '/v1/health/ready',
        tags: ['Health'],
        summary: 'Subsystem readiness probe',
        description: 'Executes all registered health checks (MongoDB, Redis, ML sidecars) and returns system state.',
        successResponse: {
            status: 200,
            description: 'System is healthy and ready to accept traffic',
            schema: ReadinessResponseSchema,
        },
    });
    router.get('/ready', async (_req, res, next) => {
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
                throw new ServiceUnavailableError('Readiness check failed: one or more subsystems are not ready', failedChecks);
            }
            res.status(200).json({
                status: 'ok',
                version: options.settings.app_version,
                mission_mode: options.settings.mission_mode,
                flags: flagSummary,
                checks: results,
            });
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
