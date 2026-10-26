import { Router } from 'express';
import { registerRoute } from '../../core/openapi.js';
import { authenticate, requireRole } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import { ClockStatusDTOSchema, SetTimeScaleBodySchema, } from '../../schemas/mission.js';
import { NotFoundError, UnauthenticatedError } from '../../core/errors.js';
import { timingSafeCompare } from '../../telemetry/ingestAuth.js';
import { verifyAccessToken } from '../../core/tokens.js';
import { getRequestId } from '../../core/requestContext.js';
export function createV1MissionRouter(deps) {
    const router = Router();
    const { missionClock, flagService, settings } = deps;
    // Middleware that accepts ANY valid JWT OR valid X-Ingest-Key
    const authenticateJwtOrIngestKey = (req, _res, next) => {
        const ingestKey = req.headers['x-ingest-key'];
        if (ingestKey !== undefined) {
            if (timingSafeCompare(ingestKey, settings.ingest_api_key)) {
                return next();
            }
            return next(new UnauthenticatedError('Invalid ingest API key'));
        }
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            try {
                const payload = verifyAccessToken(token, settings.jwt_access_secret);
                req.user = payload;
                return next();
            }
            catch (err) {
                return next(err);
            }
        }
        return next(new UnauthenticatedError('Authentication required via Bearer JWT or X-Ingest-Key'));
    };
    // 1. GET /v1/mission/clock
    registerRoute({
        method: 'get',
        path: '/v1/mission/clock',
        tags: ['Mission'],
        summary: 'Get shared mission clock status and current mission time (Part 2e)',
        description: 'Returns current continuous mission time, mission day, time scale multiplier, and wall time. Accepts any valid JWT or X-Ingest-Key so simulators can synchronize time.',
        successResponse: {
            status: 200,
            description: 'Current mission clock state',
            schema: ClockStatusDTOSchema,
        },
    });
    router.get('/clock', authenticateJwtOrIngestKey, (_req, res) => {
        const status = missionClock.getStatus();
        res.status(200).json(status);
    });
    // 2. PUT /v1/mission/clock
    registerRoute({
        method: 'put',
        path: '/v1/mission/clock',
        tags: ['Mission'],
        summary: 'Update mission time scale multiplier (Part 2e / 2f Demo Panel)',
        description: 'Adjusts mission time speedup (0.1 to 3600), re-anchoring to preserve continuous mission time. Admin only, gated by demo_panel_enabled feature flag.',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: SetTimeScaleBodySchema,
                    },
                },
            },
        },
        successResponse: {
            status: 200,
            description: 'Updated mission clock state',
            schema: ClockStatusDTOSchema,
        },
    });
    router.put('/clock', authenticate, requireRole('admin'), validate({ body: SetTimeScaleBodySchema }), async (req, res, next) => {
        try {
            if (!flagService.isEnabled('demo_panel_enabled')) {
                throw new NotFoundError('Demo panel operations are disabled');
            }
            const body = (res.locals.validated?.body ?? req.body);
            const caller = req.user?.sub ?? 'admin';
            const requestId = getRequestId();
            const updated = await missionClock.setTimeScale(body.time_scale, caller, requestId);
            res.status(200).json(updated);
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
