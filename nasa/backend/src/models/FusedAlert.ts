import mongoose, { Schema, type Document, type Model } from 'mongoose';
import {
  type FusedSeverity,
  type FusionSource,
  type WorkflowStatus,
  type FusedCondition,
  FUSED_SEVERITIES,
  WORKFLOW_STATUSES,
  FUSED_CONDITIONS,
  FUSION_SOURCES,
} from '../fusion/fusionConfig.js';
import { HAZARDS, type HazardName } from '../fusion/hazards.js';

export interface IFusedMember {
  source: FusionSource;
  ref_id: string;
  metric?: string;
  model_id?: string;
  model_version?: string;
  severity: FusedSeverity;
  effective_severity: FusedSeverity;
  status: 'active' | 'cleared';
  confidence?: number;
  confidence_capped: boolean;
  raised_at: string;
  cleared_at?: string;
  last_seen_at: string;
  title?: string;
  explanation?: string;
  factors?: Array<{
    name: string;
    direction: 'up' | 'down';
    contribution: number;
  }>;
}

export interface IFusedTimelineEntry {
  at: string;
  type:
    | 'created'
    | 'member_attached'
    | 'member_cleared'
    | 'severity_changed'
    | 'escalated'
    | 'acknowledged'
    | 'assigned'
    | 'snoozed'
    | 'unsnoozed'
    | 'snooze_expired'
    | 'resolved'
    | 'note'
    | 'suppressed';
  actor_id?: string;
  actor_role?: string;
  from_status?: WorkflowStatus;
  to_status?: WorkflowStatus;
  severity?: FusedSeverity;
  note?: string;
  ref_id?: string;
}

export interface IFusedAlert extends Document {
  crew_id: string;
  hazard: HazardName;
  group_key: string;
  is_unresolved: boolean;
  status: WorkflowStatus;
  condition: FusedCondition;
  severity: FusedSeverity;
  peak_severity: FusedSeverity;
  severity_at_ack?: FusedSeverity;
  priority_score: number;
  priority_key: number;
  title: string;
  summary: string;
  explanation: string;
  factors: Array<{
    name: string;
    direction: 'up' | 'down';
    contribution: number;
  }>;
  confidence: number | null;
  sources: FusionSource[];
  metrics: string[];
  members: IFusedMember[];
  member_count_total: number;
  dropped_members: number;
  mission_mode: string;
  mission_day?: number;
  raised_at: string;
  last_activity_at: string;
  acknowledged_at?: string;
  acknowledged_by?: Array<{ user_id: string; at: string }>;
  assignee_id?: string | null;
  assigned_at?: string;
  assigned_by?: string;
  snoozed_until?: string;
  snoozed_by?: string;
  snooze_reason?: string;
  cleared_at?: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution?: 'manual' | 'dismissed' | 'condition_cleared';
  resolution_note?: string;
  dismissed_severity?: FusedSeverity;
  suppress_until?: string;
  suppressed_events: number;
  reopen_count: number;
  last_published_at?: string;
  version: number;
  timeline: IFusedTimelineEntry[];
  fusion_latency_ms?: number;
  created_at: Date;
  updated_at: Date;
}

const MemberFactorSchema = new Schema(
  {
    name: { type: String, required: true },
    direction: { type: String, enum: ['up', 'down'], required: true },
    contribution: { type: Number, required: true },
  },
  { _id: false },
);

const FusedMemberSchema = new Schema<IFusedMember>(
  {
    source: { type: String, enum: FUSION_SOURCES, required: true },
    ref_id: { type: String, required: true },
    metric: { type: String },
    model_id: { type: String },
    model_version: { type: String },
    severity: { type: String, enum: FUSED_SEVERITIES, required: true },
    effective_severity: { type: String, enum: FUSED_SEVERITIES, required: true },
    status: { type: String, enum: ['active', 'cleared'], required: true },
    confidence: { type: Number },
    confidence_capped: { type: Boolean, default: false },
    raised_at: { type: String, required: true },
    cleared_at: { type: String },
    last_seen_at: { type: String, required: true },
    title: { type: String },
    explanation: { type: String },
    factors: [MemberFactorSchema],
  },
  { _id: false },
);

const TimelineEntrySchema = new Schema<IFusedTimelineEntry>(
  {
    at: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'created',
        'member_attached',
        'member_cleared',
        'severity_changed',
        'escalated',
        'acknowledged',
        'assigned',
        'snoozed',
        'unsnoozed',
        'snooze_expired',
        'resolved',
        'note',
        'suppressed',
      ],
      required: true,
    },
    actor_id: { type: String },
    actor_role: { type: String },
    from_status: { type: String, enum: WORKFLOW_STATUSES },
    to_status: { type: String, enum: WORKFLOW_STATUSES },
    severity: { type: String, enum: FUSED_SEVERITIES },
    note: { type: String },
    ref_id: { type: String },
  },
  { _id: false },
);

const FusedAlertSchema = new Schema<IFusedAlert>(
  {
    crew_id: { type: String, required: true, index: true },
    hazard: { type: String, enum: HAZARDS, required: true, index: true },
    group_key: { type: String, required: true, index: true },
    is_unresolved: { type: Boolean, required: true, default: true, index: true },
    status: { type: String, enum: WORKFLOW_STATUSES, required: true, default: 'open', index: true },
    condition: {
      type: String,
      enum: FUSED_CONDITIONS,
      required: true,
      default: 'active',
      index: true,
    },
    severity: { type: String, enum: FUSED_SEVERITIES, required: true, index: true },
    peak_severity: { type: String, enum: FUSED_SEVERITIES, required: true },
    severity_at_ack: { type: String, enum: FUSED_SEVERITIES },
    priority_score: { type: Number, required: true },
    priority_key: { type: Number, required: true, index: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    explanation: { type: String, required: true },
    factors: [MemberFactorSchema],
    confidence: { type: Number, default: null },
    sources: [{ type: String, enum: FUSION_SOURCES }],
    metrics: [{ type: String }],
    members: [FusedMemberSchema],
    member_count_total: { type: Number, required: true, default: 0 },
    dropped_members: { type: Number, required: true, default: 0 },
    mission_mode: { type: String, required: true },
    mission_day: { type: Number },
    raised_at: { type: String, required: true },
    last_activity_at: { type: String, required: true },
    acknowledged_at: { type: String },
    acknowledged_by: [{ user_id: String, at: String, _id: false }],
    assignee_id: { type: String, default: null },
    assigned_at: { type: String },
    assigned_by: { type: String },
    snoozed_until: { type: String },
    snoozed_by: { type: String },
    snooze_reason: { type: String },
    cleared_at: { type: String },
    resolved_at: { type: String },
    resolved_by: { type: String },
    resolution: { type: String, enum: ['manual', 'dismissed', 'condition_cleared'] },
    resolution_note: { type: String },
    dismissed_severity: { type: String, enum: FUSED_SEVERITIES },
    suppress_until: { type: String },
    suppressed_events: { type: Number, default: 0 },
    reopen_count: { type: Number, default: 0 },
    last_published_at: { type: String },
    version: { type: Number, required: true, default: 1 },
    timeline: [TimelineEntrySchema],
    fusion_latency_ms: { type: Number },
  },
  {
    collection: 'fused_alerts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

// 1. Partial unique index ensuring at most one unresolved alert per group_key
FusedAlertSchema.index(
  { group_key: 1 },
  {
    unique: true,
    partialFilterExpression: { is_unresolved: true },
    name: 'unique_unresolved_per_group_key',
  },
);

// 2. Keyset pagination index: { is_unresolved: 1, priority_key: -1, _id: -1 }
FusedAlertSchema.index(
  { is_unresolved: 1, priority_key: -1, _id: -1 },
  { name: 'idx_unresolved_priority_keyset' },
);

// 3. Crew activity index: { crew_id: 1, last_activity_at: -1 }
FusedAlertSchema.index({ crew_id: 1, last_activity_at: -1 }, { name: 'idx_crew_last_activity' });

// 4. Sweeper index: { status: 1, snoozed_until: 1 }
FusedAlertSchema.index({ status: 1, snoozed_until: 1 }, { name: 'idx_status_snoozed_until' });

// 5. Dismissal lookup index: { group_key: 1, resolved_at: -1 }
FusedAlertSchema.index({ group_key: 1, resolved_at: -1 }, { name: 'idx_group_key_resolved_at' });

export const FusedAlert: Model<IFusedAlert> =
  mongoose.models['FusedAlert'] || mongoose.model<IFusedAlert>('FusedAlert', FusedAlertSchema);
