import { z } from 'zod';
import { EnvelopeSchema } from '../bus/eventTypes.js';
export const EventReplayQuerySchema = z.object({
    after: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    topic: z
        .enum(['alerts', 'emergency', 'system'], {
        errorMap: () => ({
            message: "Topic must be one of 'alerts', 'emergency', 'system'. Telemetry is ephemeral and cannot be replayed.",
        }),
    })
        .optional(),
    crew_id: z.string().optional(),
});
export const EventReplayResponseSchema = z.object({
    events: z.array(EnvelopeSchema),
    head_id: z.string().nullable(),
    truncated: z.boolean(),
    reset: z.boolean(),
});
