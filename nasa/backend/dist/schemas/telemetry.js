import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { METRICS, MetricNameEnum, SourceEnum } from '../telemetry/metrics.js';
extendZodWithOpenApi(z);
export const ObjectIdSchema = z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid 24-character hexadecimal ObjectId')
    .openapi({ description: 'MongoDB ObjectId hex string', example: '507f1f77bcf86cd799439011' });
export const IsoUtcTimestampSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'Timestamp must be an ISO 8601 UTC string ending in "Z" (time offsets are rejected)')
    .refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid ISO 8601 timestamp date value',
})
    .openapi({
    description: 'ISO 8601 UTC timestamp strictly ending in Z',
    example: '2026-10-18T12:00:00.000Z',
});
export const TelemetryReadingInputSchema = z
    .object({
    crew_id: ObjectIdSchema,
    metric: MetricNameEnum.openapi({ description: 'Metric identifier from registry' }),
    value: z
        .number()
        .refine(Number.isFinite, { message: 'Value must be a finite number' })
        .nullable()
        .openapi({ description: 'Measured value, or null for sensor dropout', example: 72 }),
    timestamp: IsoUtcTimestampSchema,
    source: SourceEnum.openapi({ description: 'Data provenance source' }),
    dataset_id: z
        .string()
        .optional()
        .openapi({ description: 'Dataset ID (required for replayed_dataset)' }),
    device_id: z.string().optional().openapi({ description: 'Sensor hardware identifier' }),
    mission_day: z
        .number()
        .nonnegative()
        .optional()
        .openapi({ description: 'Mission elapsed day' }),
    unit: z.string().optional().openapi({ description: 'Measurement unit' }),
})
    .superRefine((data, ctx) => {
    if (data.source === 'replayed_dataset' &&
        (!data.dataset_id || data.dataset_id.trim().length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['dataset_id'],
            message: 'dataset_id is required when source is "replayed_dataset"',
        });
    }
    if (data.unit !== undefined) {
        const canonical = METRICS[data.metric]?.unit;
        if (canonical && data.unit !== canonical) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['unit'],
                message: `Unit "${data.unit}" does not match canonical unit "${canonical}" for metric "${data.metric}"`,
            });
        }
    }
})
    .openapi('TelemetryReadingInput');
export const TelemetryBatchRequestSchema = z
    .object({
    batch_id: z.string().optional().openapi({
        description: 'Client-provided batch tracking ID (used as idempotency key if present)',
        example: 'batch-sol42-hr-001',
    }),
    readings: z
        .array(TelemetryReadingInputSchema)
        .min(1, 'readings array must contain at least 1 reading')
        .max(500, 'readings array exceeds maximum batch size of 500')
        .openapi({ description: 'List of sensor readings to ingest' }),
})
    .openapi('TelemetryBatchRequest');
export const RejectedReadingSchema = z
    .object({
    index: z.number().openapi({ description: 'Index of rejected reading in submitted batch' }),
    code: z.string().openapi({ description: 'Machine error code' }),
    message: z.string().openapi({ description: 'Explanation of rejection reason' }),
})
    .openapi('RejectedReading');
export const DetectedGapSchema = z
    .object({
    crew_id: z.string(),
    metric: z.string(),
    from: z.string(),
    to: z.string(),
    seconds: z.number(),
})
    .openapi('DetectedGap');
export const QualityBreakdownSchema = z
    .object({
    ok: z.number().openapi({ description: 'Count of readings with ok flag' }),
    flagged: z.number().openapi({ description: 'Count of non-ok readings' }),
    by_flag: z.object({
        dropout: z.number(),
        implausible: z.number(),
        flatline: z.number(),
        spike: z.number(),
        interpolated: z.number(),
    }),
})
    .openapi('QualityBreakdown');
export const TelemetryBatchResponseSchema = z
    .object({
    batch_id: z.string().optional(),
    received: z.number().openapi({ description: 'Total readings received in payload' }),
    accepted: z.number().openapi({ description: 'Total readings successfully ingested' }),
    rejected: z
        .array(RejectedReadingSchema)
        .openapi({ description: 'Readings rejected due to semantic errors' }),
    duplicates_in_batch: z.number().openapi({ description: 'Duplicates collapsed inside batch' }),
    interpolated: z
        .number()
        .openapi({ description: 'Linearly interpolated readings created for gaps' }),
    gaps: z
        .array(DetectedGapSchema)
        .max(20)
        .openapi({ description: 'Detected unfillable gaps (> max_interp_gap_s)' }),
    quality: QualityBreakdownSchema,
})
    .openapi('TelemetryBatchResponse');
export const StoredReadingDtoSchema = z
    .object({
    crew_id: z.string(),
    metric: z.string(),
    value: z.number().nullable(),
    unit: z.string().optional(),
    timestamp: z.string(),
    source: z.string(),
    quality: z.object({
        flag: z.string(),
        reasons: z.array(z.string()),
    }),
})
    .openapi('StoredReadingDto');
export const LatestTelemetryResponseSchema = z
    .object({
    crew_id: z.string(),
    metrics: z.record(z.object({
        latest: StoredReadingDtoSchema.nullable(),
        latest_ok: StoredReadingDtoSchema.nullable(),
    })),
})
    .openapi('LatestTelemetryResponse');
