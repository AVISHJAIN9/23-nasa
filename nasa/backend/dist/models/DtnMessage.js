/**
 * @module DtnMessage
 * Mongoose model for Delay-Tolerant Network (DTN) store-and-forward messages (Phase 4).
 *
 * Ground <-> Onboard message queue supporting:
 * - High-latency store-and-forward
 * - Monotonic sequencing & ordering
 * - Idempotency deduplication
 * - Conflict-safe reconciliation on comms reconnect
 */
import mongoose, { Schema } from 'mongoose';
const DtnMessageSchema = new Schema({
    message_id: { type: String, required: true, unique: true, index: true },
    direction: { type: String, enum: ['uplink', 'downlink'], required: true, index: true },
    sender_id: { type: String, required: true, index: true },
    sender_role: { type: String, required: true },
    type: { type: String, required: true, index: true },
    target_id: { type: String, default: null, index: true },
    payload: { type: Schema.Types.Mixed, default: () => ({}) },
    sequence_number: { type: Number, required: true, index: true },
    idempotency_key: { type: String, required: true, unique: true, index: true },
    status: {
        type: String,
        enum: ['queued', 'in_flight', 'delivered', 'dropped', 'conflict'],
        default: 'queued',
        index: true,
    },
    created_at: { type: Date, default: () => new Date(), index: true },
    release_at: { type: Date, default: null, index: true },
    conflict_resolution: {
        type: new Schema({
            resolved: { type: Boolean, default: false },
            policy: { type: String, enum: ['onboard_wins', 'ground_wins', 'merged'] },
            winner_message_id: { type: String, default: null },
            details: { type: String, default: '' },
            reconciled_at: { type: Date, default: null },
            reconciled_by: { type: String, default: null },
        }, { _id: false }),
        default: null,
    },
}, {
    collection: 'dtn_messages',
    versionKey: false,
});
DtnMessageSchema.index({ direction: 1, sequence_number: 1 });
DtnMessageSchema.index({ status: 1, release_at: 1 });
export const DtnMessage = mongoose.model('DtnMessage', DtnMessageSchema);
