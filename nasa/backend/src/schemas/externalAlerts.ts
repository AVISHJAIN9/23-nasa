import { z } from 'zod';
import { HazardEnum } from '../fusion/hazards.js';
import { FusedSeverityEnum } from '../fusion/fusionConfig.js';
import { KNOWN_METRIC_NAMES } from '../telemetry/metrics.js';

export const ExternalAlertFactorSchema = z.object({
  name: z.string().min(1).max(100),
  direction: z.enum(['up', 'down']),
  contribution: z.number().min(0).max(1),
});

export const SingleExternalAlertSchema = z.object({
  external_id: z.string().min(1).max(100),
  source: z.enum(['anomaly', 'risk']),
  crew_id: z.string().min(1).max(100),
  hazard: HazardEnum,
  metrics: z.array(z.enum(KNOWN_METRIC_NAMES as [string, ...string[]])).optional(),
  severity: FusedSeverityEnum,
  status: z.enum(['active', 'cleared']),
  confidence: z.number().min(0).max(1),
  score: z.number().optional(),
  model_id: z.string().max(100).optional(),
  model_version: z.string().max(50).optional(),
  raised_at: z.string().datetime({ message: 'raised_at must be an ISO 8601 UTC timestamp with Z' }),
  event_at: z
    .string()
    .datetime({ message: 'event_at must be an ISO 8601 UTC timestamp with Z' })
    .optional(),
  explanation: z.string().min(1).max(500),
  factors: z.array(ExternalAlertFactorSchema).max(5).optional(),
  evidence: z.record(z.unknown()).optional(),
  mission_mode: z.enum(['iss', 'moon', 'mars']).optional(),
  mission_day: z.number().int().min(1).optional(),
});

export type SingleExternalAlertInput = z.infer<typeof SingleExternalAlertSchema>;

export const ExternalAlertsBatchBodySchema = z.object({
  alerts: z.array(SingleExternalAlertSchema).min(1).max(100),
});

export type ExternalAlertsBatchBody = z.infer<typeof ExternalAlertsBatchBodySchema>;

export const ExternalAlertsResponseSchema = z.object({
  received: z.number().int().min(0),
  accepted: z.number().int().min(0),
  rejected: z.array(
    z.object({
      index: z.number().int().min(0),
      code: z.string(),
      message: z.string(),
    }),
  ),
});

export type ExternalAlertsResponse = z.infer<typeof ExternalAlertsResponseSchema>;
