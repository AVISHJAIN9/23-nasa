import { z } from 'zod';
import {
  WORKFLOW_STATUSES,
  FUSED_CONDITIONS,
  FUSED_SEVERITIES,
  FUSION_SOURCES,
} from '../fusion/fusionConfig.js';
import { HAZARDS } from '../fusion/hazards.js';

export const AcknowledgedByEntrySchema = z.object({
  user_id: z.string(),
  at: z.string(),
});

export const TimelineEntryDTOSchema = z.object({
  at: z.string(),
  type: z.string(),
  actor_id: z.string().optional(),
  actor_role: z.string().optional(),
  from_status: z.string().optional(),
  to_status: z.string().optional(),
  severity: z.string().optional(),
  note: z.string().optional(),
  ref_id: z.string().optional(),
});

export const FusedMemberDTOSchema = z.object({
  source: z.enum(FUSION_SOURCES),
  ref_id: z.string(),
  metric: z.string().optional(),
  model_id: z.string().optional(),
  model_version: z.string().optional(),
  severity: z.enum(FUSED_SEVERITIES),
  effective_severity: z.enum(FUSED_SEVERITIES),
  status: z.enum(['active', 'cleared']),
  confidence: z.number().optional(),
  confidence_capped: z.boolean(),
  raised_at: z.string(),
  cleared_at: z.string().optional(),
  last_seen_at: z.string(),
  title: z.string().optional(),
  explanation: z.string().optional(),
  factors: z
    .array(
      z.object({
        name: z.string(),
        direction: z.enum(['up', 'down']),
        contribution: z.number(),
      }),
    )
    .optional(),
});

export const InboxItemDTOSchema = z.object({
  id: z.string(),
  crew_id: z.string(),
  hazard: z.enum(HAZARDS),
  status: z.enum(WORKFLOW_STATUSES),
  condition: z.enum(FUSED_CONDITIONS),
  severity: z.enum(FUSED_SEVERITIES),
  peak_severity: z.enum(FUSED_SEVERITIES),
  priority_score: z.number(),
  priority_key: z.number(),
  title: z.string(),
  summary: z.string(),
  sources: z.array(z.enum(FUSION_SOURCES)),
  metrics: z.array(z.string()),
  member_count: z.number(),
  confidence: z.number().nullable(),
  assignee_id: z.string().nullable().optional(),
  acknowledged_by: z.array(AcknowledgedByEntrySchema).optional(),
  acknowledged_at: z.string().optional(),
  snoozed_until: z.string().optional(),
  raised_at: z.string(),
  last_activity_at: z.string(),
  version: z.number(),
  mission_mode: z.string(),
  // Detail fields
  members: z.array(FusedMemberDTOSchema).optional(),
  factors: z
    .array(
      z.object({
        name: z.string(),
        direction: z.enum(['up', 'down']),
        contribution: z.number(),
      }),
    )
    .optional(),
  explanation: z.string().optional(),
  timeline: z.array(TimelineEntryDTOSchema).optional(),
  resolution: z.enum(['manual', 'dismissed', 'condition_cleared']).optional(),
  resolution_note: z.string().optional(),
  snooze_reason: z.string().optional(),
  snoozed_by: z.string().optional(),
  reopen_count: z.number().optional(),
  cleared_at: z.string().optional(),
  resolved_at: z.string().optional(),
  resolved_by: z.string().optional(),
});

export type InboxItemDTO = z.infer<typeof InboxItemDTOSchema>;

export const InboxQuerySchema = z.object({
  status: z.string().optional(), // comma-separated list
  severity: z.string().optional(),
  crew_id: z.string().optional(),
  hazard: z.string().optional(),
  source: z.string().optional(),
  condition: z.string().optional(),
  assignee: z.string().optional(), // 'me' | userId | 'none'
  needs_attention: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (typeof val === 'string') return val.toLowerCase() === 'true';
      return val;
    }),
  sort: z.enum(['priority', 'recent']).default('priority'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type InboxQuery = z.infer<typeof InboxQuerySchema>;

export const AcknowledgeBodySchema = z.object({
  expected_version: z.number().int().min(1).optional(),
  note: z.string().max(1000).optional(),
});

export type AcknowledgeBody = z.infer<typeof AcknowledgeBodySchema>;

export const AssignBodySchema = z.object({
  assignee_id: z.string().nullable(),
  expected_version: z.number().int().min(1).optional(),
});

export type AssignBody = z.infer<typeof AssignBodySchema>;

export const SnoozeBodySchema = z.object({
  duration_min: z.number().int().min(1),
  reason: z.string().min(3).max(200),
  expected_version: z.number().int().min(1).optional(),
});

export type SnoozeBody = z.infer<typeof SnoozeBodySchema>;

export const UnsnoozeBodySchema = z.object({
  expected_version: z.number().int().min(1).optional(),
});

export type UnsnoozeBody = z.infer<typeof UnsnoozeBodySchema>;

export const ResolveBodySchema = z.object({
  resolution_note: z.string().max(1000).optional(),
  expected_version: z.number().int().min(1).optional(),
});

export type ResolveBody = z.infer<typeof ResolveBodySchema>;

export const AddNoteBodySchema = z.object({
  text: z.string().min(1).max(1000),
});

export type AddNoteBody = z.infer<typeof AddNoteBodySchema>;

export const ActionResponseSchema = z.object({
  item: InboxItemDTOSchema,
  changed: z.boolean(),
  event: z
    .object({
      uid: z.string(),
      id: z.string().nullable(),
      bus: z.enum(['ok', 'degraded']),
    })
    .nullable(),
});

export type ActionResponse = z.infer<typeof ActionResponseSchema>;

export const InboxSummarySchema = z.object({
  by_status: z.object({
    open: z.number().int().min(0),
    acknowledged: z.number().int().min(0),
    snoozed: z.number().int().min(0),
    resolved: z.number().int().min(0),
  }),
  by_severity: z.object({
    watch: z.number().int().min(0),
    warning: z.number().int().min(0),
    critical: z.number().int().min(0),
  }),
  unacknowledged_critical: z.number().int().min(0),
  top_crews_by_priority: z.array(
    z.object({
      crew_id: z.string(),
      max_priority: z.number(),
      open_count: z.number().int().min(0),
    }),
  ),
});

export type InboxSummary = z.infer<typeof InboxSummarySchema>;
