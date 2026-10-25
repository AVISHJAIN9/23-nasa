import { Router, type Request, type Response, type NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { registerRoute } from '../../core/openapi.js';
import { authenticate, requireRole, requireSelfOrRole } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import { timingSafeCompare } from '../../telemetry/ingestAuth.js';
import {
  CreateCrewProfileBodySchema,
  UpdateCrewProfileBodySchema,
  UpdateCrewBaselineBodySchema,
  CrewProfileResponseSchema,
  CrewProfilePageSchema,
  CrewProfileQuerySchema,
  ObjectIdParamSchema,
  type CreateCrewProfileBody,
  type UpdateCrewProfileBody,
  type UpdateCrewBaselineBody,
} from '../../schemas/crew.js';
import { CrewProfile, type ICrewProfile } from '../../models/CrewProfile.js';
import { User } from '../../models/User.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../../core/errors.js';
import type { Role } from '../../core/roles.js';
import type { Settings } from '../../core/config.js';

/**
 * Sanitizes crew profile responses based on caller role.
 * Mission control is restricted from viewing sensitive medical history.
 */
function sanitizeCrewProfile(profile: ICrewProfile, role?: Role): Record<string, unknown> {
  const json = profile.toJSON();
  if (role === 'mission_control') {
    delete json['medical_history'];
  }
  return json;
}

export interface CrewRouterDeps {
  settings?: Settings;
}

export function createV1CrewRouter(deps?: CrewRouterDeps): Router {
  const router = Router();

  // 1. POST /v1/crew (Admin only)
  registerRoute({
    method: 'post',
    path: '/v1/crew',
    tags: ['Crew'],
    summary: 'Create astronaut physiological baseline profile',
    description: 'Creates a crew profile. Optionally links to an existing User account.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateCrewProfileBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 201,
      description: 'Crew profile created successfully',
      schema: CrewProfileResponseSchema,
    },
  });

  router.post(
    '/',
    requireRole('admin'),
    validate({ body: CreateCrewProfileBodySchema }),
    async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const body = res.locals.validated?.body as CreateCrewProfileBody;

        const newProfile = await CrewProfile.create({
          user_id: body.user_id ? new mongoose.Types.ObjectId(body.user_id) : null,
          callsign: body.callsign,
          age: body.age,
          sex: body.sex,
          height_cm: body.height_cm,
          weight_kg: body.weight_kg,
          medical_history: body.medical_history,
          is_synthetic: body.is_synthetic ?? true,
        });

        // If user_id was provided, link the user
        if (body.user_id) {
          await User.findByIdAndUpdate(body.user_id, { crew_profile_id: newProfile._id });
        }

        res.status(201).json(sanitizeCrewProfile(newProfile));
      } catch (err) {
        next(err);
      }
    },
  );

  // 2. GET /v1/crew (flight_surgeon, mission_control, admin)
  registerRoute({
    method: 'get',
    path: '/v1/crew',
    tags: ['Crew'],
    summary: 'List crew profiles with cursor pagination',
    description:
      'Retrieves active crew profiles. Redacts medical history for mission_control callers.',
    successResponse: {
      status: 200,
      description: 'Paginated crew profiles',
      schema: CrewProfilePageSchema,
    },
  });

  router.get(
    '/',
    requireRole('flight_surgeon', 'mission_control', 'admin'),
    validate({ query: CrewProfileQuerySchema }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const limit = Math.min(Number(req.query['limit']) || 20, 100);
        const cursor = req.query['cursor'] as string | undefined;

        const filter: Record<string, unknown> = {};
        if (cursor && mongoose.isValidObjectId(cursor)) {
          filter['_id'] = { $gt: new mongoose.Types.ObjectId(cursor) };
        }

        const docs = await CrewProfile.find(filter)
          .sort({ _id: 1 })
          .limit(limit + 1);

        const hasNext = docs.length > limit;
        const results = hasNext ? docs.slice(0, limit) : docs;
        const nextCursor = hasNext ? results[results.length - 1]?._id.toString() : null;

        const role = req.auth?.role;
        res.status(200).json({
          items: results.map((p) => sanitizeCrewProfile(p, role)),
          next_cursor: nextCursor,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // 3. GET /v1/crew/:id (Self or flight_surgeon, mission_control, admin)
  registerRoute({
    method: 'get',
    path: '/v1/crew/{id}',
    tags: ['Crew'],
    summary: 'Get crew profile by ID',
    description:
      'Retrieves a crew profile. Astronauts may only read their own profile. Redacts medical history for mission_control.',
    request: {
      params: z.object({ id: ObjectIdParamSchema }),
    },
    successResponse: {
      status: 200,
      description: 'Crew profile details',
      schema: CrewProfileResponseSchema,
    },
  });

  router.get(
    '/:id',
    validate({ params: z.object({ id: ObjectIdParamSchema }) }),
    requireSelfOrRole('id', 'flight_surgeon', 'mission_control', 'admin'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { id } = req.params;
        const profile = await CrewProfile.findById(id);

        if (!profile) {
          throw new NotFoundError(`Crew profile '${id}' not found`);
        }

        res.status(200).json(sanitizeCrewProfile(profile, req.auth?.role));
      } catch (err) {
        next(err);
      }
    },
  );

  // 4. PATCH /v1/crew/:id (Self or admin)
  registerRoute({
    method: 'patch',
    path: '/v1/crew/{id}',
    tags: ['Crew'],
    summary: 'Update crew profile details',
    description:
      'Astronauts may update their own non-baseline fields; admins may edit all attributes. Baseline fields are immutable here.',
    request: {
      params: z.object({ id: ObjectIdParamSchema }),
      body: {
        content: {
          'application/json': {
            schema: UpdateCrewProfileBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 200,
      description: 'Crew profile updated successfully',
      schema: CrewProfileResponseSchema,
    },
  });

  router.patch(
    '/:id',
    validate({
      params: z.object({ id: ObjectIdParamSchema }),
      body: UpdateCrewProfileBodySchema,
    }),
    requireSelfOrRole('id', 'admin'),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { id } = req.params;
        const body = res.locals.validated?.body as UpdateCrewProfileBody;

        // Baseline fields are strictly read-only through this API
        if ('baseline' in req.body) {
          throw new ValidationError(
            'Baseline physiological vitals are read-only through this API',
            [{ field: 'baseline', issue: 'Field is immutable through crew profile API' }],
          );
        }

        const profile = await CrewProfile.findById(id);
        if (!profile) {
          throw new NotFoundError(`Crew profile '${id}' not found`);
        }

        if (body.callsign !== undefined) profile.callsign = body.callsign;
        if (body.age !== undefined) profile.age = body.age;
        if (body.sex !== undefined) profile.sex = body.sex;
        if (body.height_cm !== undefined) profile.height_cm = body.height_cm;
        if (body.weight_kg !== undefined) profile.weight_kg = body.weight_kg;
        if (body.medical_history !== undefined) profile.medical_history = body.medical_history;

        await profile.save();
        res.status(200).json(sanitizeCrewProfile(profile, req.auth?.role));
      } catch (err) {
        next(err);
      }
    },
  );

  // 5. DELETE /v1/crew/:id (Admin only)
  registerRoute({
    method: 'delete',
    path: '/v1/crew/{id}',
    tags: ['Crew'],
    summary: 'Delete crew profile',
    description: 'Permanently removes a crew profile. Administrator authorization required.',
    request: {
      params: z.object({ id: ObjectIdParamSchema }),
    },
    successResponse: {
      status: 200,
      description: 'Crew profile deleted successfully',
      schema: z.object({ status: z.literal('ok'), deleted_id: z.string() }),
    },
  });

  router.delete(
    '/:id',
    requireRole('admin'),
    validate({ params: z.object({ id: ObjectIdParamSchema }) }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { id } = req.params;
        const profile = await CrewProfile.findByIdAndDelete(id);

        if (!profile) {
          throw new NotFoundError(`Crew profile '${id}' not found`);
        }

        // Unlink user if linked
        if (profile.user_id) {
          await User.findByIdAndUpdate(profile.user_id, { crew_profile_id: null });
        }

        res.status(200).json({ status: 'ok', deleted_id: id });
      } catch (err) {
        next(err);
      }
    },
  );

  // 6. PUT /v1/crew/:id/baseline (Flight surgeon, admin, or ML service via X-ML-Key)
  registerRoute({
    method: 'put',
    path: '/v1/crew/{id}/baseline',
    tags: ['Crew'],
    summary: 'Update astronaut physiological baseline vitals',
    description:
      'Sets or updates personal baseline physiological metrics for anomaly detection. Authorized via X-ML-Key service key or flight_surgeon / admin roles.',
    request: {
      params: z.object({ id: ObjectIdParamSchema }),
      body: {
        content: {
          'application/json': {
            schema: UpdateCrewBaselineBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 200,
      description: 'Crew baseline vitals updated successfully',
      schema: CrewProfileResponseSchema,
    },
  });

  router.put(
    '/:id/baseline',
    validate({
      params: z.object({ id: ObjectIdParamSchema }),
      body: UpdateCrewBaselineBodySchema,
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const mlKeyHeader = req.headers['x-ml-key'];
        const mlKey =
          typeof mlKeyHeader === 'string'
            ? mlKeyHeader
            : Array.isArray(mlKeyHeader)
              ? (mlKeyHeader[0] ?? '')
              : '';

        let isMlAuthorized = false;
        if (mlKey && deps?.settings?.ml_api_key) {
          isMlAuthorized = timingSafeCompare(mlKey, deps.settings.ml_api_key);
        }

        if (!isMlAuthorized) {
          if (!req.auth) {
            await new Promise<void>((resolve, reject) => {
              authenticate(req, res, (err?: unknown) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }

          if (req.auth?.role !== 'flight_surgeon' && req.auth?.role !== 'admin') {
            throw new ForbiddenError(
              `Insufficient permissions: baseline updates require flight_surgeon or admin role, caller has '${req.auth?.role}'`,
            );
          }
        }

        const { id } = req.params;
        const body = (res.locals.validated?.body ?? req.body) as UpdateCrewBaselineBody;

        const profile = await CrewProfile.findById(id);
        if (!profile) {
          throw new NotFoundError(`Crew profile '${id}' not found`);
        }

        const incoming = (body.baseline ?? body) as Record<string, number | null | undefined>;
        const currentBaseline =
          typeof (profile.baseline as unknown as { toObject?: () => Record<string, unknown> })
            ?.toObject === 'function'
            ? (
                profile.baseline as unknown as { toObject: () => Record<string, unknown> }
              ).toObject()
            : (profile.baseline ?? {});

        const updatedBaseline = { ...currentBaseline };
        if (incoming['resting_hr'] !== undefined)
          updatedBaseline['resting_hr'] = incoming['resting_hr'];
        if (incoming['spo2'] !== undefined) updatedBaseline['spo2'] = incoming['spo2'];
        if (incoming['systolic'] !== undefined) updatedBaseline['systolic'] = incoming['systolic'];
        if (incoming['diastolic'] !== undefined)
          updatedBaseline['diastolic'] = incoming['diastolic'];
        if (incoming['temp_c'] !== undefined) updatedBaseline['temp_c'] = incoming['temp_c'];
        if (incoming['resp_rate'] !== undefined)
          updatedBaseline['resp_rate'] = incoming['resp_rate'];
        if (incoming['hrv_rmssd'] !== undefined)
          updatedBaseline['hrv_rmssd'] = incoming['hrv_rmssd'];

        profile.baseline = updatedBaseline;
        profile.baseline_status = 'computed';

        await profile.save();
        res.status(200).json(sanitizeCrewProfile(profile, req.auth?.role));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
