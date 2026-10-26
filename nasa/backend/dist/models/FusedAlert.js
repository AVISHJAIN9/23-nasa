import mongoose, { Schema } from 'mongoose';
import { FUSED_SEVERITIES, WORKFLOW_STATUSES, FUSED_CONDITIONS, FUSION_SOURCES, } from '../fusion/fusionConfig.js';
import { HAZARDS } from '../fusion/hazards.js';
const MemberFactorSchema = new Schema({
    name: { type: String, required: true },
    direction: { type: String, enum: ['up', 'down'], required: true },
    contribution: { type: Number, required: true },
}, { _id: false });
const FusedMemberSchema = new Schema({
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
}, { _id: false });
const TimelineEntrySchema = new Schema({
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
}, { _id: false });
const FusedAlertSchema = new Schema({
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
}, {
    collection: 'fused_alerts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});
// 1. Partial unique index ensuring at most one unresolved alert per group_key
FusedAlertSchema.index({ group_key: 1 }, {
    unique: true,
    partialFilterExpression: { is_unresolved: true },
    name: 'unique_unresolved_per_group_key',
});
// 2. Keyset pagination index: { is_unresolved: 1, priority_key: -1, _id: -1 }
FusedAlertSchema.index({ is_unresolved: 1, priority_key: -1, _id: -1 }, { name: 'idx_unresolved_priority_keyset' });
// 3. Crew activity index: { crew_id: 1, last_activity_at: -1 }
FusedAlertSchema.index({ crew_id: 1, last_activity_at: -1 }, { name: 'idx_crew_last_activity' });
// 4. Sweeper index: { status: 1, snoozed_until: 1 }
FusedAlertSchema.index({ status: 1, snoozed_until: 1 }, { name: 'idx_status_snoozed_until' });
// 5. Dismissal lookup index: { group_key: 1, resolved_at: -1 }
FusedAlertSchema.index({ group_key: 1, resolved_at: -1 }, { name: 'idx_group_key_resolved_at' });
export const FusedAlert = mongoose.models['FusedAlert'] || mongoose.model('FusedAlert', FusedAlertSchema);
