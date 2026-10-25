import { Router, type Request, type Response, type NextFunction } from 'express';
import { registerRoute } from '../../core/openapi.js';
import { authenticate, requireRole } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import { type MissionClockService } from '../../mission/missionClock.js';
import { type FlagService } from '../../core/flags.js';
import { type Settings } from '../../core/config.js';
import {
  ClockStatusDTOSchema,
  SetTimeScaleBodySchema,
  type SetTimeScaleBody,
} from '../../schemas/mission.js';
import { NotFoundError, UnauthenticatedError } from '../../core/errors.js';
import { timingSafeCompare } from '../../telemetry/ingestAuth.js';
import { verifyAccessToken } from '../../core/tokens.js';
import { getRequestId } from '../../core/requestContext.js';

export interface MissionRouterDeps {
  missionClock: MissionClockService;
  flagService: FlagService;
  settings: Settings;
}

export function createV1MissionRouter(deps: MissionRouterDeps): Router {
  const router = Router();
  const { missionClock, flagService, settings } = deps;

  // Middleware that accepts ANY valid JWT OR valid X-Ingest-Key
  const authenticateJwtOrIngestKey = (req: Request, _res: Response, next: NextFunction): void => {
    const ingestKey = req.headers['x-ingest-key'] as string | undefined;
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
        (req as unknown as { user: typeof payload }).user = payload;
        return next();
      } catch (err) {
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
    description:
      'Returns current continuous mission time, mission day, time scale multiplier, and wall time. Accepts any valid JWT or X-Ingest-Key so simulators can synchronize time.',
    successResponse: {
      status: 200,
      description: 'Current mission clock state',
      schema: ClockStatusDTOSchema,
    },
  });

  router.get('/clock', authenticateJwtOrIngestKey, (_req: Request, res: Response) => {
    const status = missionClock.getStatus();
    res.status(200).json(status);
  });

  // 2. PUT /v1/mission/clock
  registerRoute({
    method: 'put',
    path: '/v1/mission/clock',
    tags: ['Mission'],
    summary: 'Update mission time scale multiplier (Part 2e / 2f Demo Panel)',
    description:
      'Adjusts mission time speedup (0.1 to 3600), re-anchoring to preserve continuous mission time. Admin only, gated by demo_panel_enabled feature flag.',
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

  router.put(
    '/clock',
    authenticate,
    requireRole('admin'),
    validate({ body: SetTimeScaleBodySchema }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!flagService.isEnabled('demo_panel_enabled')) {
          throw new NotFoundError('Demo panel operations are disabled');
        }

        const body = (res.locals.validated?.body ?? req.body) as SetTimeScaleBody;
        const caller = (req as unknown as { user?: { sub?: string } }).user?.sub ?? 'admin';
        const requestId = getRequestId();

        const updated = await missionClock.setTimeScale(body.time_scale, caller, requestId);
        res.status(200).json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
