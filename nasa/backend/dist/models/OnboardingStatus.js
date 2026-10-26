import mongoose, { Schema } from 'mongoose';
const OnboardingStepsSchema = new Schema({
    consent_acknowledged: { type: Boolean, default: false },
    profile_completed: { type: Boolean, default: false },
    device_paired: { type: Boolean, default: false },
    baseline_ready: { type: Boolean, default: false },
}, { _id: false });
const OnboardingStatusSchema = new Schema({
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
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
        transform(_doc, ret) {
            ret['id'] = String(ret['_id']);
            ret['user_id'] = String(ret['user_id']);
            delete ret['_id'];
            delete ret['__v'];
            return ret;
        },
    },
});
export const OnboardingStatus = mongoose.models['OnboardingStatus'] ||
    mongoose.model('OnboardingStatus', OnboardingStatusSchema);
