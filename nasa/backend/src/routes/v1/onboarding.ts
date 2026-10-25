import { Router, type Request, type Response, type NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { registerRoute } from '../../core/openapi.js';
import { authenticate, requireRole } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import {
  PatchOnboardingBodySchema,
  OnboardingStatusResponseSchema,
  ONBOARDING_STEP_ORDER,
  type PatchOnboardingBody,
  type OnboardingStep,
} from '../../schemas/onboarding.js';
import { ObjectIdParamSchema } from '../../schemas/crew.js';
import { OnboardingStatus, type IOnboardingStatus } from '../../models/OnboardingStatus.js';
import { User } from '../../models/User.js';
import { CrewProfile } from '../../models/CrewProfile.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';

/**
 * Computes the next incomplete milestone in sequential order.
 */
function computeNextStep(status: IOnboardingStatus): OnboardingStep | null {
  for (const step of ONBOARDING_STEP_ORDER) {
    if (!status.steps[step]) {
      return step;
    }
  }
  return null;
}

/**
 * Formats an onboarding document into the response contract.
 */
function formatOnboardingResponse(status: IOnboardingStatus) {
  return {
    user_id: String(status.user_id),
    steps: {
      consent_acknowledged: Boolean(status.steps.consent_acknowledged),
      profile_completed: Boolean(status.steps.profile_completed),
      device_paired: Boolean(status.steps.device_paired),
      baseline_ready: Boolean(status.steps.baseline_ready),
    },
    next_step: computeNextStep(status),
    completed_at: status.completed_at ? status.completed_at.toISOString() : null,
    updated_at: status.updated_at ? status.updated_at.toISOString() : undefined,
  };
}

export function createV1OnboardingRouter(): Router {
  const router = Router();

  // 1. GET /v1/onboarding/status (Current user)
  registerRoute({
    method: 'get',
    path: '/v1/onboarding/status',
    tags: ['Onboarding'],
    summary: 'Get onboarding status and next pending step for caller',
    description:
      'Retrieves current astronaut onboarding milestones and evaluates the next sequential step.',
    successResponse: {
      status: 200,
      description: 'Caller onboarding state',
      schema: OnboardingStatusResponseSchema,
    },
  });

  router.get(
    '/status',
    authenticate,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.auth?.userId;
        let statusDoc = await OnboardingStatus.findOne({ user_id: userId });

        if (!statusDoc) {
          statusDoc = await OnboardingStatus.create({
            user_id: new mongoose.Types.ObjectId(userId),
          });
        }

        res.status(200).json(formatOnboardingResponse(statusDoc));
      } catch (err) {
        next(err);
      }
    },
  );

  // 2. PATCH /v1/onboarding/status (Current user)
  registerRoute({
    method: 'patch',
    path: '/v1/onboarding/status',
    tags: ['Onboarding'],
    summary: 'Update milestone progress for current astronaut',
    description:
      'Marks consent_acknowledged or profile_completed. Reserved hardware steps return 422.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: PatchOnboardingBodySchema,
          },
        },
      },
    },
    successResponse: {
      status: 200,
      description: 'Onboarding step recorded',
      schema: OnboardingStatusResponseSchema,
    },
  });

  router.patch(
    '/status',
    authenticate,
    validate({ body: PatchOnboardingBodySchema }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.auth?.userId;
        const { step, done } = res.locals.validated?.body as PatchOnboardingBody;

        // F007 rule: device_paired and baseline_ready are reserved for later hardware integrations
        if (step === 'device_paired' || step === 'baseline_ready') {
          throw new ValidationError(
            `Step '${step}' is reserved for future hardware and telemetry integration phases.`,
            [{ field: 'step', issue: 'Step cannot be updated via client API' }],
          );
        }

        // F007 rule: profile_completed can only be set true if crew profile exists
        if (step === 'profile_completed' && done) {
          const user = await User.findById(userId);
          const hasCrewProfile =
            Boolean(user?.crew_profile_id) ||
            Boolean(await CrewProfile.findOne({ user_id: userId }));

          if (!hasCrewProfile) {
            throw new ValidationError(
              'Cannot mark profile_completed as done before creating a crew profile record',
              [{ field: 'step', issue: 'Crew profile record not found for this astronaut' }],
            );
          }
        }

        let statusDoc = await OnboardingStatus.findOne({ user_id: userId });
        if (!statusDoc) {
          statusDoc = new OnboardingStatus({
            user_id: new mongoose.Types.ObjectId(userId),
          });
        }

        statusDoc.steps[step] = done;

        // Check if all four steps are now complete
        const allCompleted =
          statusDoc.steps.consent_acknowledged &&
          statusDoc.steps.profile_completed &&
          statusDoc.steps.device_paired &&
          statusDoc.steps.baseline_ready;

        statusDoc.completed_at = allCompleted ? new Date() : null;
        await statusDoc.save();

        res.status(200).json(formatOnboardingResponse(statusDoc));
      } catch (err) {
        next(err);
      }
    },
  );

  // 3. GET /v1/onboarding/status/:userId (Admin only)
  registerRoute({
    method: 'get',
    path: '/v1/onboarding/status/{userId}',
    tags: ['Onboarding'],
    summary: 'Inspect onboarding progress for a specific astronaut',
    description: 'Allows administrators to audit onboarding status across crew members.',
    request: {
      params: z.object({ userId: ObjectIdParamSchema }),
    },
    successResponse: {
      status: 200,
      description: 'Target astronaut onboarding status',
      schema: OnboardingStatusResponseSchema,
    },
  });

  router.get(
    '/status/:userId',
    requireRole('admin'),
    validate({ params: z.object({ userId: ObjectIdParamSchema }) }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.params['userId'] as string;
        let statusDoc = await OnboardingStatus.findOne({ user_id: userId });

        if (!statusDoc) {
          const targetUser = await User.findById(userId);
          if (!targetUser) {
            throw new NotFoundError(`User '${userId}' not found`);
          }
          statusDoc = await OnboardingStatus.create({
            user_id: new mongoose.Types.ObjectId(userId),
          });
        }

        res.status(200).json(formatOnboardingResponse(statusDoc));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
