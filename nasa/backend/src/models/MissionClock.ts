import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IMissionClock extends Document {
  mission_start_at: Date;
  anchor_wall_at: Date;
  anchor_mission_at: Date;
  time_scale: number;
  updated_by: string;
  updated_at: Date;
  version: number;
}

const MissionClockSchema = new Schema<IMissionClock>(
  {
    mission_start_at: { type: Date, required: true },
    anchor_wall_at: { type: Date, required: true },
    anchor_mission_at: { type: Date, required: true },
    time_scale: { type: Number, required: true, min: 0.1, max: 3600 },
    updated_by: { type: String, required: true, default: 'system' },
    updated_at: { type: Date, required: true, default: Date.now },
    version: { type: Number, required: true, default: 1 },
  },
  {
    collection: 'mission_clock',
    timestamps: false,
    versionKey: false,
  },
);

export const MissionClock: Model<IMissionClock> =
  mongoose.models['MissionClock'] ||
  mongoose.model<IMissionClock>('MissionClock', MissionClockSchema);
