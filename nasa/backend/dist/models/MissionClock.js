import mongoose, { Schema } from 'mongoose';
const MissionClockSchema = new Schema({
    mission_start_at: { type: Date, required: true },
    anchor_wall_at: { type: Date, required: true },
    anchor_mission_at: { type: Date, required: true },
    time_scale: { type: Number, required: true, min: 0.1, max: 3600 },
    updated_by: { type: String, required: true, default: 'system' },
    updated_at: { type: Date, required: true, default: Date.now },
    version: { type: Number, required: true, default: 1 },
}, {
    collection: 'mission_clock',
    timestamps: false,
    versionKey: false,
});
export const MissionClock = mongoose.models['MissionClock'] ||
    mongoose.model('MissionClock', MissionClockSchema);
