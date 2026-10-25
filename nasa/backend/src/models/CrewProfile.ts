import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IBaseline {
  resting_hr?: number;
  spo2?: number;
  systolic?: number;
  diastolic?: number;
  temp_c?: number;
  resp_rate?: number;
  hrv_rmssd?: number;
}

export interface ICrewProfile extends Document {
  _id: mongoose.Types.ObjectId;
  user_id?: mongoose.Types.ObjectId | null;
  callsign: string;
  age: number;
  sex: 'female' | 'male' | 'other';
  height_cm: number;
  weight_kg: number;
  medical_history: string[];
  baseline: IBaseline;
  baseline_status: 'pending' | 'computed';
  is_synthetic: boolean;
  created_at: Date;
  updated_at: Date;
}

const BaselineSchema = new Schema<IBaseline>(
  {
    resting_hr: { type: Number, default: null },
    spo2: { type: Number, default: null },
    systolic: { type: Number, default: null },
    diastolic: { type: Number, default: null },
    temp_c: { type: Number, default: null },
    resp_rate: { type: Number, default: null },
    hrv_rmssd: { type: Number, default: null },
  },
  { _id: false },
);

const CrewProfileSchema = new Schema<ICrewProfile>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: { unique: true, sparse: true },
    },
    callsign: {
      type: String,
      required: true,
      trim: true,
    },
    age: {
      type: Number,
      required: true,
      min: 18,
      max: 80,
    },
    sex: {
      type: String,
      enum: ['female', 'male', 'other'],
      required: true,
    },
    height_cm: {
      type: Number,
      required: true,
      min: 100,
      max: 250,
    },
    weight_kg: {
      type: Number,
      required: true,
      min: 30,
      max: 200,
    },
    medical_history: {
      type: [String],
      default: [],
    },
    baseline: {
      type: BaselineSchema,
      default: () => ({}),
    },
    baseline_status: {
      type: String,
      enum: ['pending', 'computed'],
      default: 'pending',
    },
    is_synthetic: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret['id'] = String(ret['_id']);
        if (ret['user_id']) {
          ret['user_id'] = String(ret['user_id']);
        }
        delete ret['_id'];
        delete ret['__v'];
        return ret;
      },
    },
  },
);

export const CrewProfile: Model<ICrewProfile> =
  (mongoose.models['CrewProfile'] as Model<ICrewProfile>) ||
  mongoose.model<ICrewProfile>('CrewProfile', CrewProfileSchema);
