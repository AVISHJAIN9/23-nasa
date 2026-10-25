import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { ALERT_SEVERITIES, type AlertSeverity } from '../alerts/alertTypes.js';

export interface IAlert extends Document {
  crew_id: string;
  metric: string;
  value: number | null;
  threshold_value?: number;
  direction?: 'above' | 'below';
  severity: AlertSeverity;
  status: 'active' | 'acknowledged' | 'cleared';
  message: string;
  raised_at: string;
  cleared_at?: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  mission_mode: string;
  mission_day?: number;
  request_id?: string;
  created_at: Date;
  updated_at: Date;
}

const AlertSchema = new Schema<IAlert>(
  {
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
  },
  {
    collection: 'alerts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

AlertSchema.index({ status: 1, crew_id: 1 });

export const Alert: Model<IAlert> =
  mongoose.models['Alert'] || mongoose.model<IAlert>('Alert', AlertSchema);
