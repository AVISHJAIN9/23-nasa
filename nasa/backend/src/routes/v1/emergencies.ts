import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { registerRoute } from '../../core/openapi.js';
import { authenticate, requireRole } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import { User } from '../../models/User.js';
import { type Principal } from '../../bus/audience.js';
import { UnauthenticatedError } from '../../core/errors.js';
import { EmergencyService, type EmergencyServiceDeps } from '../../emergency/emergencyService.js';
import {
  DeclareEmergencyBodySchema,
  ResolveEmergencyBodySchema,
  CancelEmergencyBodySchema,
  EmergencyQuerySchema,
  EmergencyDTOSchema,
  type DeclareEmergencyBody,
  type ResolveEmergencyBody,
  type EmergencyQuery,
} from '../../schemas/emergencies.js';
import { createPageSchema } from '../../schemas/common.js';

export async function getCallerPrincipal(req: Request): Promise<Principal> {
  const auth = req.auth;
  if (!auth) {
    throw new UnauthenticatedError('Authentication required');
  }

  let crewId: string | null = null;
  if (auth.role === 'astronaut') {
    const user = await User.findById(auth.userId).lean();
    if (user?.crew_profile_id) {
      crewId = String(user.crew_profile_id);
    }
  }

  return {
    userId: auth.userId,
    role: auth.role,
    isMedicalOfficer: auth.isMedicalOfficer,
    crewId,
  };
}

export function createV1EmergenciesRouter(deps: EmergencyServiceDeps): Router {
  const router = Router();
  const service = new EmergencyService(deps);

  // 1. POST /v1/emergencies - Declare emergency
  registerRoute({
    method: 'post',
    path: '/v1/emergencies',
    tags: ['Emergencies'],
    summary: 'Declare a medical or operational emergency (F063)',
    description:
      'Creates and broadcasts a critical emergency event to dashboards in under 3 seconds. Idempotent by client_request_id.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: DeclareEmergencyBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 201,
      description: 'Emergency successfully declared or returned if deduplicated/idempotent',
      schema: z.object({
        emergency: EmergencyDTOSchema,
        broadcast: z.object({
          event_id: z.string().nullable(),
          uid: z.string(),
          bus: z.enum(['ok', 'degraded']),
        }),
        deduplicated: z.boolean().optional(),
      }),
    },
  });

  router.post(
    '/',
    authenticate,
    requireRole('astronaut', 'admin'),
    validate({ body: DeclareEmergencyBodySchema }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const caller = await getCallerPrincipal(req);
        const body = (res.locals.validated?.body ?? req.body) as DeclareEmergencyBody;
        const result = await service.declare({ caller, body });
        res.status(result.statusCode).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // 2. GET /v1/emergencies - List emergencies with cursor pagination
  registerRoute({
    method: 'get',
    path: '/v1/emergencies',
    tags: ['Emergencies'],
    summary: 'List emergencies with cursor pagination and role projection (F063)',
    description:
      'Returns paginated emergencies. Astronauts only see their crew; medical and ground staff see all.',
    request: {
      query: EmergencyQuerySchema,
    },
    successResponse: {
      status: 200,
      description: 'Paginated list of emergencies',
      schema: createPageSchema(EmergencyDTOSchema, 'EmergencyPage'),
    },
  });

  router.get(
    '/',
    authenticate,
    validate({ query: EmergencyQuerySchema }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const caller = await getCallerPrincipal(req);
        const query = (res.locals.validated?.query ?? req.query) as EmergencyQuery;
        const result = await service.list(query, caller);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // 3. GET /v1/emergencies/:id - Get emergency by ID
  registerRoute({
    method: 'get',
    path: '/v1/emergencies/{id}',
    tags: ['Emergencies'],
    summary: 'Get emergency details by ID (F063)',
    description: 'Retrieves an emergency by its unique identifier with role-based note redaction.',
    request: {
      params: z.object({ id: z.string() }),
    },
    successResponse: {
      status: 200,
      description: 'Emergency details',
      schema: z.object({
        emergency: EmergencyDTOSchema,
      }),
    },
  });

  router.get(
    '/:id',
    authenticate,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const caller = await getCallerPrincipal(req);
        const emergency = await service.getById(req.params.id as string, caller);
        res.status(200).json({ emergency });
      } catch (err) {
        next(err);
      }
    },
  );

  // 4. POST /v1/emergencies/:id/acknowledge
  registerRoute({
    method: 'post',
    path: '/v1/emergencies/{id}/acknowledge',
    tags: ['Emergencies'],
    summary: 'Acknowledge an active emergency (F063)',
    description: 'Appends acknowledging user and transitions active emergency to acknowledged.',
    request: {
      params: z.object({ id: z.string() }),
    },
    successResponse: {
      status: 200,
      description: 'Emergency acknowledged',
      schema: z.object({
        emergency: EmergencyDTOSchema,
        broadcast: z.object({
          event_id: z.string().nullable(),
          uid: z.string(),
          bus: z.enum(['ok', 'degraded']),
        }),
      }),
    },
  });

  router.post(
    '/:id/acknowledge',
    authenticate,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const caller = await getCallerPrincipal(req);
        const result = await service.acknowledge(req.params.id as string, caller);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // 5. POST /v1/emergencies/:id/resolve
  registerRoute({
    method: 'post',
    path: '/v1/emergencies/{id}/resolve',
    tags: ['Emergencies'],
    summary: 'Resolve an active or acknowledged emergency (F063)',
    description:
      'Flight Surgeons or Admins mark the emergency resolved with an optional resolution note.',
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: ResolveEmergencyBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 200,
      description: 'Emergency resolved',
      schema: z.object({
        emergency: EmergencyDTOSchema,
        broadcast: z.object({
          event_id: z.string().nullable(),
          uid: z.string(),
          bus: z.enum(['ok', 'degraded']),
        }),
      }),
    },
  });

  router.post(
    '/:id/resolve',
    authenticate,
    requireRole('flight_surgeon', 'admin'),
    validate({ body: ResolveEmergencyBodySchema }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const caller = await getCallerPrincipal(req);
        const body = (res.locals.validated?.body ?? req.body) as ResolveEmergencyBody;
        const result = await service.resolve(
          req.params.id as string,
          caller,
          body?.resolution_note,
        );
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // 6. POST /v1/emergencies/:id/cancel
  registerRoute({
    method: 'post',
    path: '/v1/emergencies/{id}/cancel',
    tags: ['Emergencies'],
    summary: 'Cancel an erroneously declared emergency (F063)',
    description:
      'Can be cancelled by the declaring astronaut within the cancel window (ASTRO_EMERGENCY_CANCEL_WINDOW_S) or by an admin anytime.',
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: CancelEmergencyBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 200,
      description: 'Emergency cancelled',
      schema: z.object({
        emergency: EmergencyDTOSchema,
        broadcast: z.object({
          event_id: z.string().nullable(),
          uid: z.string(),
          bus: z.enum(['ok', 'degraded']),
        }),
      }),
    },
  });

  router.post(
    '/:id/cancel',
    authenticate,
    requireRole('astronaut', 'admin'),
    validate({ body: CancelEmergencyBodySchema }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const caller = await getCallerPrincipal(req);
        const result = await service.cancel(req.params.id as string, caller);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
