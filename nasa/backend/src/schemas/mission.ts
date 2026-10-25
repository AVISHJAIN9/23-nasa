import { z } from 'zod';

export const ClockStatusDTOSchema = z.object({
  mission_now: z.string().datetime(),
  mission_day: z.number().int(),
  mission_start_at: z.string().datetime(),
  time_scale: z.number(),
  wall_now: z.string().datetime(),
  mission_mode: z.string(),
});

export type ClockStatusDTO = z.infer<typeof ClockStatusDTOSchema>;

export const SetTimeScaleBodySchema = z.object({
  time_scale: z
    .number()
    .min(0.1)
    .max(3600)
    .describe('Mission time speedup multiplier (0.1 to 3600)'),
});

export type SetTimeScaleBody = z.infer<typeof SetTimeScaleBodySchema>;
