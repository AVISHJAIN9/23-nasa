import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
extendZodWithOpenApi(z);
export const ErrorCodeEnum = z.enum([
    'BAD_REQUEST',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'CONFLICT',
    'VALIDATION_ERROR',
    'RATE_LIMITED',
    'INTERNAL_ERROR',
    'SERVICE_UNAVAILABLE',
]);
export const ErrorDetailSchema = z
    .object({
    field: z
        .string()
        .openapi({ description: 'Dotted field path that triggered the error', example: 'body.spo2' }),
    issue: z.string().openapi({
        description: 'Human-readable description of the issue',
        example: 'must be between 0 and 100',
    }),
})
    .openapi('ErrorDetail');
export const ErrorBodySchema = z
    .object({
    code: ErrorCodeEnum.openapi({
        description: 'Standard machine-readable error code',
        example: 'VALIDATION_ERROR',
    }),
    message: z.string().openapi({
        description: 'Human-readable error explanation',
        example: 'Request validation failed',
    }),
    request_id: z.string().uuid().openapi({
        description: 'Correlation ID of the request',
        example: 'd8b2e1b4-5f5a-4b9b-8f3a-1d1a1b1c1d1e',
    }),
    details: z
        .union([z.array(ErrorDetailSchema), z.record(z.unknown())])
        .optional()
        .openapi({ description: 'Detailed field-level validation issues or conflict metadata' }),
})
    .openapi('ErrorBody');
export const ErrorResponseSchema = z
    .object({
    error: ErrorBodySchema,
})
    .openapi('ErrorResponse');
/**
 * Mission-aware payload temporal reference containing both UTC timestamp and sol/mission day.
 */
export const MissionTimeSchema = z
    .object({
    timestamp: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'Must be an ISO 8601 UTC timestamp ending in Z')
        .openapi({
        description: 'ISO 8601 timestamp in UTC ending with Z',
        example: '2026-10-17T18:00:00Z',
    }),
    mission_day: z
        .number()
        .int()
        .nonnegative()
        .openapi({ description: 'Mission day (Sol or Flight Day number)', example: 142 }),
})
    .openapi('MissionTime');
/**
 * Creates a cursor-based pagination schema for any item schema.
 */
export function createPageSchema(itemSchema, name) {
    const schema = z.object({
        items: z.array(itemSchema).openapi({ description: 'Paginated collection items' }),
        next_cursor: z.string().nullable().optional().openapi({
            description: 'Opaque cursor string for fetching the subsequent page, or null if end of feed',
            example: 'eyJpZCI6IjY3MTBkMWZhIn0=',
        }),
        has_more: z.boolean().optional().openapi({
            description: 'Whether additional pages are available beyond this page',
            example: true,
        }),
    });
    return name ? schema.openapi(name) : schema;
}
