import mongoose, { Schema } from 'mongoose';
import { FUSED_SEVERITIES } from '../fusion/fusionConfig.js';
import { HAZARDS } from '../fusion/hazards.js';
const ExternalAlertFactorSchema = new Schema({
    name: { type: String, required: true },
    direction: { type: String, enum: ['up', 'down'], required: true },
    contribution: { type: Number, required: true },
}, { _id: false });
const ExternalAlertSchema = new Schema({
    source: { type: String, enum: ['anomaly', 'risk'], required: true },
    external_id: { type: String, required: true },
    crew_id: { type: String, required: true, index: true },
    hazard: { type: String, enum: HAZARDS, required: true },
    metrics: [{ type: String }],
    severity: { type: String, enum: FUSED_SEVERITIES, required: true },
    status: { type: String, enum: ['active', 'cleared'], required: true },
    confidence: { type: Number, required: true },
    score: { type: Number },
    model_id: { type: String },
    model_version: { type: String },
    raised_at: { type: String, required: true },
    event_at: { type: String, required: true },
    explanation: { type: String, maxlength: 500, required: true },
    factors: [ExternalAlertFactorSchema],
    mission_mode: { type: String, required: true },
}, {
    collection: 'external_alerts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});
ExternalAlertSchema.index({ source: 1, external_id: 1 }, { unique: true });
export const ExternalAlert = mongoose.models['ExternalAlert'] ||
    mongoose.model('ExternalAlert', ExternalAlertSchema);
