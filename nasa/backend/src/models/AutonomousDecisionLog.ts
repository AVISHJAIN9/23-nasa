/**
 * @module AutonomousDecisionLog
 * Mongoose model for Autonomous Decisions taken by Crew Medical Officer during comms blackout (Phase 4).
 *
 * Records clinical actions, vital signs snapshot, link state at execution time,
 * and tracks asynchronous reconciliation by Ground Flight Surgeon upon reconnect.
 */

import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IAutonomousDecisionLog extends Document {
  decision_id: string;
  protocol_id: string;
  step_id: string;
  emergency_id?: string | null;
  actor_id: string;
  actor_role: string;
  action_taken: string;
  notes: string;
  crew_id?: string | null;
  vital_signs_snapshot: Record<string, unknown>;
  link_state_at_decision: {
    in_blackout: boolean;
    effective_delay_ms: number;
  };
  reconciled: boolean;
  reconciled_at?: Date | null;
  reconciled_by?: string | null;
  reconciliation_status?: 'accepted' | 'amended' | 'flagged' | null;
  reconciliation_notes?: string | null;
  created_at: Date;
}

const AutonomousDecisionLogSchema = new Schema<IAutonomousDecisionLog>(
  {
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
  },
  {
    collection: 'autonomous_decision_logs',
    versionKey: false,
  },
);

AutonomousDecisionLogSchema.index({ reconciled: 1, created_at: -1 });

export const AutonomousDecisionLog: Model<IAutonomousDecisionLog> =
  mongoose.model<IAutonomousDecisionLog>('AutonomousDecisionLog', AutonomousDecisionLogSchema);
