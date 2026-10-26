/**
 * @module LinkBlackout
 * Mongoose model for scheduled / pre-planned blackout windows (Part 2e / F070).
 *
 * Stored blackouts allow mission control to schedule known signal outages
 * (e.g. planned maintenance, known solar conjunction windows) in advance.
 * These complement the profile-derived computed blackouts from LinkModel.
 *
 * The CommsDelayEmulator merges stored blackouts with profile-computed blackouts
 * when evaluating link state.
 */
import mongoose, { Schema } from 'mongoose';
const LinkBlackoutSchema = new Schema({
    label: { type: String, required: true },
    start_at: { type: Date, required: true, index: true },
    end_at: { type: Date, required: true, index: true },
    mission_mode: {
        type: String,
        enum: ['iss', 'moon', 'mars', null],
        default: null,
    },
    direction: {
        type: String,
        enum: ['uplink', 'downlink', null],
        default: null,
    },
    created_by: { type: String, required: true },
    created_at: { type: Date, default: () => new Date() },
}, {
    collection: 'link_blackouts',
    versionKey: false,
});
// Compound index for efficient "active at time T" queries
LinkBlackoutSchema.index({ start_at: 1, end_at: 1 });
export const LinkBlackout = mongoose.model('LinkBlackout', LinkBlackoutSchema);
