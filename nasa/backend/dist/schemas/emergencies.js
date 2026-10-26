import { z } from 'zod';
import { EMERGENCY_TYPES, EMERGENCY_SOURCES, EMERGENCY_STATUSES } from '../models/Emergency.js';
export const DeclareEmergencyBodySchema = z.object({
    crew_id: z.string().optional(),
    type: z.enum(EMERGENCY_TYPES, {
        errorMap: () => ({
            message: `type must be one of: ${EMERGENCY_TYPES.join(', ')}`,
        }),
    }),
    note: z.string().max(500, 'Note must not exceed 500 characters').trim().optional(),
    source: z.enum(EMERGENCY_SOURCES).default('button'),
    client_request_id: z.string().uuid('client_request_id must be a valid UUID v4'),
});
export const AcknowledgeEmergencyBodySchema = z.object({}).optional();
export const ResolveEmergencyBodySchema = z
    .object({
    resolution_note: z
        .string()
        .max(500, 'Resolution note must not exceed 500 characters')
        .trim()
        .optional(),
})
    .optional()
    .default({});
export const CancelEmergencyBodySchema = z
    .object({
    reason: z
        .string()
        .max(500, 'Cancellation reason must not exceed 500 characters')
        .trim()
        .optional(),
})
    .optional()
    .default({});
export const EmergencyQuerySchema = z.object({
    status: z.enum(EMERGENCY_STATUSES).optional(),
    crew_id: z.string().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
});
export const EmergencyDTOSchema = z.object({
    id: z.string(),
    crew_id: z.string(),
    declared_by: z.string(),
    type: z.enum(EMERGENCY_TYPES),
    note: z.string().optional(),
    source: z.enum(EMERGENCY_SOURCES),
    status: z.enum(EMERGENCY_STATUSES),
    declared_at: z.string(),
    acknowledged_by: z.array(z.object({
        user_id: z.string(),
        at: z.string(),
    })),
    resolved_at: z.string().nullable().optional(),
    resolved_by: z.string().nullable().optional(),
    resolution_note: z.string().nullable().optional(),
    cancelled_at: z.string().nullable().optional(),
    cancelled_by: z.string().nullable().optional(),
    mission_mode: z.enum(['iss', 'moon', 'mars']),
    mission_day: z.number().nullable().optional(),
    protocol_id: z.string().nullable().optional(),
    client_request_id: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
});
