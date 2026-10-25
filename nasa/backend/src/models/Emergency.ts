import mongoose, { Schema, type Document, type Model, Types } from 'mongoose';

export const EMERGENCY_TYPES = [
  'medical_general',
  'cardiac',
  'breathing',
  'trauma_injury',
  'burn',
  'toxic_atmosphere',
  'allergic_reaction',
  'other',
] as const;
export type EmergencyType = (typeof EMERGENCY_TYPES)[number];

export const EMERGENCY_SOURCES = ['button', 'voice', 'api'] as const;
export type EmergencySource = (typeof EMERGENCY_SOURCES)[number];

export const EMERGENCY_STATUSES = ['active', 'acknowledged', 'resolved', 'cancelled'] as const;
export type EmergencyStatus = (typeof EMERGENCY_STATUSES)[number];

export interface IAcknowledgedBy {
  user_id: string;
  at: Date;
}

export interface IEmergency {
  crew_id: Types.ObjectId | string;
  declared_by: Types.ObjectId | string;
  type: EmergencyType;
  note?: string;
  source: EmergencySource;
  status: EmergencyStatus;
  declared_at: Date;
  acknowledged_by: IAcknowledgedBy[];
  resolved_at?: Date | null;
  resolved_by?: string | null;
  resolution_note?: string | null;
  cancelled_at?: Date | null;
  cancelled_by?: string | null;
  mission_mode: 'iss' | 'moon' | 'mars';
  mission_day?: number | null;
  protocol_id?: string | null;
  client_request_id: string;
  request_id?: string | null;
  created_at: Date;
  updated_at: Date;
}

export type EmergencyDocument = IEmergency & Document;

const AcknowledgedBySchema = new Schema<IAcknowledgedBy>(
  {
    user_id: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const EmergencySchema = new Schema<EmergencyDocument>(
  {
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
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

EmergencySchema.index({ declared_by: 1, client_request_id: 1 }, { unique: true });
EmergencySchema.index({ status: 1, declared_at: -1 });
EmergencySchema.index({ crew_id: 1, declared_at: -1 });

export const Emergency: Model<EmergencyDocument> =
  mongoose.models['Emergency'] || mongoose.model<EmergencyDocument>('Emergency', EmergencySchema);
