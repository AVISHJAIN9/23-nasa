import mongoose, { Schema } from 'mongoose';
export const EMERGENCY_TYPES = [
    'medical_general',
    'cardiac',
    'breathing',
    'trauma_injury',
    'burn',
    'toxic_atmosphere',
    'allergic_reaction',
    'other',
];
export const EMERGENCY_SOURCES = ['button', 'voice', 'api'];
export const EMERGENCY_STATUSES = ['active', 'acknowledged', 'resolved', 'cancelled'];
const AcknowledgedBySchema = new Schema({
    user_id: { type: String, required: true },
    at: { type: Date, required: true },
}, { _id: false });
const EmergencySchema = new Schema({
    crew_id: { type: Schema.Types.Mixed, required: true, ref: 'CrewProfile' },
    declared_by: { type: Schema.Types.Mixed, required: true, ref: 'User' },
    type: {
        type: String,
        required: true,
        enum: EMERGENCY_TYPES,
    },
    note: {
        type: String,
        maxlength: 500,
        trim: true,
    },
    source: {
        type: String,
        required: true,
        enum: EMERGENCY_SOURCES,
        default: 'button',
    },
    status: {
        type: String,
        required: true,
        enum: EMERGENCY_STATUSES,
        default: 'active',
    },
    declared_at: {
        type: Date,
        required: true,
        default: Date.now,
    },
    acknowledged_by: {
        type: [AcknowledgedBySchema],
        default: [],
    },
    resolved_at: { type: Date, default: null },
    resolved_by: { type: String, default: null },
    resolution_note: { type: String, maxlength: 500, trim: true, default: null },
    cancelled_at: { type: Date, default: null },
    cancelled_by: { type: String, default: null },
    mission_mode: {
        type: String,
        required: true,
        enum: ['iss', 'moon', 'mars'],
        default: 'mars',
    },
    mission_day: { type: Number, default: null },
    protocol_id: { type: String, default: null },
    client_request_id: { type: String, required: true },
    request_id: { type: String, default: null },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});
EmergencySchema.index({ declared_by: 1, client_request_id: 1 }, { unique: true });
EmergencySchema.index({ status: 1, declared_at: -1 });
EmergencySchema.index({ crew_id: 1, declared_at: -1 });
export const Emergency = mongoose.models['Emergency'] || mongoose.model('Emergency', EmergencySchema);
