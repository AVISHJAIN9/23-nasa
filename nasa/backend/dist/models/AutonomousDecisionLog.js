/**
 * @module AutonomousDecisionLog
 * Mongoose model for Autonomous Decisions taken by Crew Medical Officer during comms blackout (Phase 4).
 *
 * Records clinical actions, vital signs snapshot, link state at execution time,
 * and tracks asynchronous reconciliation by Ground Flight Surgeon upon reconnect.
 */
import mongoose, { Schema } from 'mongoose';
const AutonomousDecisionLogSchema = new Schema({
    decision_id: { type: String, required: true, unique: true, index: true },
    protocol_id: { type: String, required: true, index: true },
    step_id: { type: String, required: true },
    emergency_id: { type: String, default: null, index: true },
    actor_id: { type: String, required: true, index: true },
    actor_role: { type: String, required: true },
    action_taken: { type: String, required: true },
    notes: { type: String, default: '' },
    crew_id: { type: String, default: null, index: true },
    vital_signs_snapshot: { type: Schema.Types.Mixed, default: () => ({}) },
    link_state_at_decision: {
        in_blackout: { type: Boolean, required: true },
        effective_delay_ms: { type: Number, required: true },
    },
    reconciled: { type: Boolean, default: false, index: true },
    reconciled_at: { type: Date, default: null },
    reconciled_by: { type: String, default: null },
    reconciliation_status: {
        type: String,
        enum: ['accepted', 'amended', 'flagged'],
        default: null,
    },
    reconciliation_notes: { type: String, default: null },
    created_at: { type: Date, default: () => new Date(), index: true },
}, {
    collection: 'autonomous_decision_logs',
    versionKey: false,
});
AutonomousDecisionLogSchema.index({ reconciled: 1, created_at: -1 });
export const AutonomousDecisionLog = mongoose.model('AutonomousDecisionLog', AutonomousDecisionLogSchema);
