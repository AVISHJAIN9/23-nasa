import { z } from 'zod';

export const FUSED_SEVERITIES = ['watch', 'warning', 'critical'] as const;
export type FusedSeverity = (typeof FUSED_SEVERITIES)[number];
export const FusedSeverityEnum = z.enum(FUSED_SEVERITIES);

export const WORKFLOW_STATUSES = ['open', 'acknowledged', 'snoozed', 'resolved'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export const WorkflowStatusEnum = z.enum(WORKFLOW_STATUSES);

export const FUSED_CONDITIONS = ['active', 'cleared'] as const;
export type FusedCondition = (typeof FUSED_CONDITIONS)[number];
export const FusedConditionEnum = z.enum(FUSED_CONDITIONS);

export const FUSION_SOURCES = ['rule', 'anomaly', 'risk'] as const;
export type FusionSource = (typeof FUSION_SOURCES)[number];
export const FusionSourceEnum = z.enum(FUSION_SOURCES);

/**
 * Numeric severity rank for comparisons and escalation.
 * watch (1) < warning (2) < critical (3)
 */
export const SEVERITY_RANKS: Readonly<Record<FusedSeverity, number>> = {
  watch: 1,
  warning: 2,
  critical: 3,
};

/**
 * Base priority score according to severity matrix.
 */
export const BASE_PRIORITY_SCORES: Readonly<Record<FusedSeverity, number>> = {
  watch: 10,
  warning: 40,
  critical: 80,
};

/**
 * Corroboration bonus weights.
 */
export const CORROBORATION_BONUS = {
  PER_EXTRA_SOURCE: 10,
  PER_EXTRA_METRIC: 5,
  MAX_BONUS: 20,
} as const;

/**
 * Attention weight per workflow status for keyset sorting.
 * priority_key = attention_weight * 1000 + priority_score
 */
export const ATTENTION_WEIGHTS: Readonly<Record<WorkflowStatus, number>> = {
  open: 3,
  acknowledged: 2,
  snoozed: 1,
  resolved: 0,
};

/**
 * Snooze duration limits (minutes).
 */
export const SNOOZE_LIMITS_DEFAULT = {
  WATCH_MAX_MIN: 480,
  WARNING_MAX_MIN: 60,
  CRITICAL_ALLOWED: false,
} as const;
