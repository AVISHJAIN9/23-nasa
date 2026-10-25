import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { registerRoute } from '../../core/openapi.js';
import { requireRole } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import {
  type FlagService,
  FlagsResponseSchema,
  FlagUpdateBodySchema,
  FlagUpdateResponseSchema,
} from '../../core/flags.js';

export interface FlagsRouterOptions {
  flagService: FlagService;
}

/**
 * Creates the /v1/flags router with list and update capabilities.
 */
export function createV1FlagsRouter(options: FlagsRouterOptions): Router {
  const router = Router();
  const { flagService } = options;

  // 1. GET /v1/flags
  registerRoute({
    method: 'get',
    path: '/v1/flags',
    tags: ['Flags'],
    summary: 'List all feature flags',
    description: 'Retrieves current evaluation state for all system feature flags.',
    successResponse: {
      status: 200,
      description: 'Feature flags dictionary',
      schema: FlagsResponseSchema,
    },
  });

  router.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const allFlags = await flagService.all();
      res.status(200).json(allFlags);
    } catch (err) {
      next(err);
    }
  });

  // 2. PUT /v1/flags/:name
  registerRoute({
    method: 'put',
    path: '/v1/flags/{name}',
    tags: ['Flags'],
    summary: 'Update a feature flag value',
    description:
      'Modifies a feature flag value in runtime memory or database. Requires admin role.',
    request: {
      params: z.object({
        name: z.string().openapi({ description: 'Flag name to update', example: 'ml_enabled' }),
      }),
      body: {
        content: {
          'application/json': {
            schema: FlagUpdateBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 200,
      description: 'Flag successfully updated',
      schema: FlagUpdateResponseSchema,
    },
  });

  router.put(
    '/:name',
    requireRole('admin'),
    validate({
      params: z.object({
        name: z.string().min(1, 'Flag name must not be empty'),
      }),
      body: FlagUpdateBodySchema,
    }),
    async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const validated = res.locals.validated;
        const name = (validated?.params as { name: string }).name;
        const value = (validated?.body as { value: unknown }).value;

        await flagService.set(name, value);
        const updatedValue = await flagService.get(name);

        res.status(200).json({
          name,
          value: updatedValue,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
