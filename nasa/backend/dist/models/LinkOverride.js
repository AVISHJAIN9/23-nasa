/**
 * @module LinkOverride
 * Mongoose model for administrative comms-link overrides (Part 2e / F070).
 *
 * An active override lets mission control force a specific delay or blackout state,
 * temporarily bypassing the computed link model (e.g. for training exercises or
 * to simulate a degraded link scenario).
 *
 * Only one override per direction is expected to be active at a time.
 * New overrides overwrite the previous one for the same direction.
 */
import mongoose, { Schema } from 'mongoose';
const LinkOverrideSchema = new Schema({
    direction: {
        type: String,
        enum: ['uplink', 'downlink'],
        required: true,
        index: true,
    },
    force_delay_ms: { type: Number, default: undefined },
    force_blackout: { type: Boolean, default: undefined },
    force_packet_loss_rate: { type: Number, default: undefined },
    actor_id: { type: String, required: true },
    expires_at: { type: Number, default: undefined },
    created_at: { type: Date, default: () => new Date() },
}, {
    collection: 'link_overrides',
    versionKey: false,
});
export const LinkOverride = mongoose.model('LinkOverride', LinkOverrideSchema);
