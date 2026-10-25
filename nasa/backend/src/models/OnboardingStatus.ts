import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IOnboardingSteps {
  consent_acknowledged: boolean;
  profile_completed: boolean;
  device_paired: boolean;
  baseline_ready: boolean;
}

export interface IOnboardingStatus extends Document {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  steps: IOnboardingSteps;
  completed_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

const OnboardingStepsSchema = new Schema<IOnboardingSteps>(
  {
    consent_acknowledged: { type: Boolean, default: false },
    profile_completed: { type: Boolean, default: false },
    device_paired: { type: Boolean, default: false },
    baseline_ready: { type: Boolean, default: false },
  },
  { _id: false },
);

const OnboardingStatusSchema = new Schema<IOnboardingStatus>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    steps: {
      type: OnboardingStepsSchema,
      default: () => ({
        consent_acknowledged: false,
        profile_completed: false,
        device_paired: false,
        baseline_ready: false,
      }),
    },
    completed_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret['id'] = String(ret['_id']);
        ret['user_id'] = String(ret['user_id']);
        delete ret['_id'];
        delete ret['__v'];
        return ret;
      },
    },
  },
);

export const OnboardingStatus: Model<IOnboardingStatus> =
  (mongoose.models['OnboardingStatus'] as Model<IOnboardingStatus>) ||
  mongoose.model<IOnboardingStatus>('OnboardingStatus', OnboardingStatusSchema);
