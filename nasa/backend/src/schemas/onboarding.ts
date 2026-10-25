import { z } from 'zod';

export const ONBOARDING_STEP_ORDER = [
  'consent_acknowledged',
  'profile_completed',
  'device_paired',
  'baseline_ready',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEP_ORDER)[number];

export const OnboardingStepsSchema = z
  .object({
    consent_acknowledged: z.boolean().openapi({ example: true }),
    profile_completed: z.boolean().openapi({ example: false }),
    device_paired: z.boolean().openapi({ example: false }),
    baseline_ready: z.boolean().openapi({ example: false }),
  })
  .openapi('OnboardingSteps');

export const PatchOnboardingBodySchema = z
  .object({
    step: z.enum(ONBOARDING_STEP_ORDER).openapi({
      description:
        'Onboarding step to update (only consent_acknowledged and profile_completed are client-settable)',
      example: 'consent_acknowledged',
    }),
    done: z.boolean().openapi({ example: true }),
  })
  .openapi('PatchOnboardingBody');

export const OnboardingStatusResponseSchema = z
  .object({
    user_id: z.string().openapi({ example: '6710d1fa73a11b0012c89012' }),
    steps: OnboardingStepsSchema,
    next_step: z.enum(ONBOARDING_STEP_ORDER).nullable().openapi({
      description: 'The next pending onboarding milestone, or null if fully completed',
      example: 'profile_completed',
    }),
    completed_at: z.string().nullable().optional().openapi({ example: null }),
    updated_at: z.string().optional().openapi({ example: '2026-10-17T18:00:00.000Z' }),
  })
  .openapi('OnboardingStatusResponse');

export type PatchOnboardingBody = z.infer<typeof PatchOnboardingBodySchema>;
export type OnboardingStatusResponse = z.infer<typeof OnboardingStatusResponseSchema>;
