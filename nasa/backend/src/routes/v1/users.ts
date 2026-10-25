import { Router, type Request, type Response, type NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { registerRoute } from '../../core/openapi.js';
import { requireRole } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import {
  CreateUserBodySchema,
  UpdateUserBodySchema,
  MedicalOfficerBodySchema,
  UserResponseSchema,
  UserPageSchema,
  UserQuerySchema,
  type CreateUserBody,
  type UpdateUserBody,
  type MedicalOfficerBody,
} from '../../schemas/users.js';
import { ObjectIdParamSchema } from '../../schemas/crew.js';
import { User } from '../../models/User.js';
import { hashPassword } from '../../core/passwords.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import type { AuditWriter } from '../../core/audit.js';

export interface UsersRouterOptions {
  auditWriter: AuditWriter;
}

export function createV1UsersRouter(options: UsersRouterOptions): Router {
  const router = Router();
  const { auditWriter } = options;

  // 1. POST /v1/users (Admin only)
  registerRoute({
    method: 'post',
    path: '/v1/users',
    tags: ['Users'],
    summary: 'Provision a new astronaut or ground personnel account',
    description:
      'Creates a user with hashed password and role assignment. Enforces unique email and 12-char password policy.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateUserBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 201,
      description: 'User created successfully',
      schema: UserResponseSchema,
    },
  });

  router.post(
    '/',
    requireRole('admin'),
    validate({ body: CreateUserBodySchema }),
    async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const body = res.locals.validated?.body as CreateUserBody;

        const existing = await User.findOne({ email: body.email });
        if (existing) {
          throw new ConflictError(`User with email '${body.email}' already exists`);
        }

        const password_hash = await hashPassword(body.password);
        const newUser = await User.create({
          email: body.email,
          display_name: body.display_name,
          role: body.role,
          password_hash,
          is_medical_officer: false,
          status: 'active',
        });

        res.status(201).json(newUser.toJSON());
      } catch (err) {
        next(err);
      }
    },
  );

  // 2. GET /v1/users (Admin only)
  registerRoute({
    method: 'get',
    path: '/v1/users',
    tags: ['Users'],
    summary: 'List users with cursor-based pagination and role filters',
    description:
      'Retrieves a paginated list of accounts. Excludes password hashes and internal database attributes.',
    successResponse: {
      status: 200,
      description: 'Paginated user list',
      schema: UserPageSchema,
    },
  });

  router.get(
    '/',
    requireRole('admin'),
    validate({ query: UserQuerySchema }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const limit = Math.min(Number(req.query['limit']) || 20, 100);
        const cursor = req.query['cursor'] as string | undefined;
        const role = req.query['role'] as string | undefined;
        const status = req.query['status'] as string | undefined;

        const filter: Record<string, unknown> = {};
        if (role) filter['role'] = role;
        if (status) filter['status'] = status;
        if (cursor && mongoose.isValidObjectId(cursor)) {
          filter['_id'] = { $gt: new mongoose.Types.ObjectId(cursor) };
        }

        const docs = await User.find(filter)
          .sort({ _id: 1 })
          .limit(limit + 1);

        const hasNext = docs.length > limit;
        const results = hasNext ? docs.slice(0, limit) : docs;
        const nextCursor = hasNext ? results[results.length - 1]?._id.toString() : null;

        res.status(200).json({
          items: results.map((u) => u.toJSON()),
          next_cursor: nextCursor,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // 3. PATCH /v1/users/:id (Admin only)
  registerRoute({
    method: 'patch',
    path: '/v1/users/{id}',
    tags: ['Users'],
    summary: 'Update user profile attributes, status, or role',
    description:
      'Updates user metadata. Prevents an administrator from demoting or disabling their own active account.',
    request: {
      params: z.object({ id: ObjectIdParamSchema }),
      body: {
        content: {
          'application/json': {
            schema: UpdateUserBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 200,
      description: 'User updated successfully',
      schema: UserResponseSchema,
    },
  });

  router.patch(
    '/:id',
    requireRole('admin'),
    validate({
      params: z.object({ id: ObjectIdParamSchema }),
      body: UpdateUserBodySchema,
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { id } = req.params;
        const body = res.locals.validated?.body as UpdateUserBody;
        const callerId = req.auth?.userId;

        const targetUser = await User.findById(id);
        if (!targetUser) {
          throw new NotFoundError(`User '${id}' not found`);
        }

        // Self-protection: admin cannot disable or demote themselves
        if (callerId === id) {
          if (body.status === 'disabled') {
            throw new ConflictError('Administrators cannot disable their own account');
          }
          if (body.role && body.role !== 'admin') {
            throw new ConflictError('Administrators cannot demote their own account role');
          }
        }

        if (body.display_name !== undefined) targetUser.display_name = body.display_name;
        if (body.status !== undefined) targetUser.status = body.status;
        if (body.role !== undefined) targetUser.role = body.role;

        await targetUser.save();
        res.status(200).json(targetUser.toJSON());
      } catch (err) {
        next(err);
      }
    },
  );

  // 4. PUT /v1/users/:id/medical-officer (Admin only)
  registerRoute({
    method: 'put',
    path: '/v1/users/{id}/medical-officer',
    tags: ['Users'],
    summary: 'Grant or revoke crew medical officer designation',
    description: 'Toggles is_medical_officer on an astronaut and logs an immutable audit event.',
    request: {
      params: z.object({ id: ObjectIdParamSchema }),
      body: {
        content: {
          'application/json': {
            schema: MedicalOfficerBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 200,
      description: 'Medical officer status modified and audited',
      schema: UserResponseSchema,
    },
  });

  router.put(
    '/:id/medical-officer',
    requireRole('admin'),
    validate({
      params: z.object({ id: ObjectIdParamSchema }),
      body: MedicalOfficerBodySchema,
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const id = req.params['id'] as string;
        const { enabled } = (res.locals.validated?.body as MedicalOfficerBody) || {};

        const targetUser = await User.findById(id);
        if (!targetUser) {
          throw new NotFoundError(`User '${id}' not found`);
        }

        // F066 rule: Only astronauts can be designated as crew medical officers
        if (targetUser.role !== 'astronaut') {
          throw new ValidationError(
            `Medical officer status can only be granted to astronauts. User '${id}' holds role '${targetUser.role}'.`,
            [{ field: 'role', issue: 'must be astronaut' }],
          );
        }

        targetUser.is_medical_officer = enabled;
        await targetUser.save();

        // Write audit entry
        await auditWriter.write({
          actor_id: req.auth?.userId || 'system',
          action: enabled ? 'MEDICAL_OFFICER_GRANTED' : 'MEDICAL_OFFICER_REVOKED',
          target_id: id,
          at: new Date(),
          metadata: {
            previous_state: !enabled,
            new_state: enabled,
          },
        });

        res.status(200).json(targetUser.toJSON());
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
