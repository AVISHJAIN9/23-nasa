import mongoose, { Schema } from 'mongoose';
import { ALERT_SEVERITIES } from '../alerts/alertTypes.js';
const AlertSchema = new Schema({
    crew_id: { type: String, required: true, index: true },
    metric: { type: String, required: true, index: true },
    value: { type: Number, default: null },
    threshold_value: { type: Number },
    direction: { type: String, enum: ['above', 'below'] },
    severity: { type: String, enum: ALERT_SEVERITIES, required: true },
    status: {
        type: String,
        enum: ['active', 'acknowledged', 'cleared'],
        required: true,
        index: true,
    },
    message: { type: String, required: true },
    raised_at: { type: String, required: true },
    cleared_at: { type: String },
    acknowledged_at: { type: String },
    acknowledged_by: { type: String },
    mission_mode: { type: String, required: true },
    mission_day: { type: Number },
    request_id: { type: String },
}, {
    collection: 'alerts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});
AlertSchema.index({ status: 1, crew_id: 1 });
export const Alert = mongoose.models['Alert'] || mongoose.model('Alert', AlertSchema);
