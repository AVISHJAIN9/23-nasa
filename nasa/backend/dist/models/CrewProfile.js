import mongoose, { Schema } from 'mongoose';
const BaselineSchema = new Schema({
    resting_hr: { type: Number, default: null },
    spo2: { type: Number, default: null },
    systolic: { type: Number, default: null },
    diastolic: { type: Number, default: null },
    temp_c: { type: Number, default: null },
    resp_rate: { type: Number, default: null },
    hrv_rmssd: { type: Number, default: null },
}, { _id: false });
const CrewProfileSchema = new Schema({
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
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
        transform(_doc, ret) {
            ret['id'] = String(ret['_id']);
            if (ret['user_id']) {
                ret['user_id'] = String(ret['user_id']);
            }
            delete ret['_id'];
            delete ret['__v'];
            return ret;
        },
    },
});
export const CrewProfile = mongoose.models['CrewProfile'] ||
    mongoose.model('CrewProfile', CrewProfileSchema);
