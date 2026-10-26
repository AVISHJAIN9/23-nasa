import mongoose, { Schema } from 'mongoose';
import { ROLES } from '../core/roles.js';
const UserSchema = new Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true,
    },
    password_hash: {
        type: String,
        required: true,
    },
    display_name: {
        type: String,
        required: true,
        trim: true,
    },
    role: {
        type: String,
        enum: ROLES,
        required: true,
        index: true,
    },
    is_medical_officer: {
        type: Boolean,
        default: false,
    },
    status: {
        type: String,
        enum: ['active', 'disabled'],
        default: 'active',
        index: true,
    },
    crew_profile_id: {
        type: Schema.Types.ObjectId,
        ref: 'CrewProfile',
        default: null,
    },
    failed_login_count: {
        type: Number,
        default: 0,
    },
    locked_until: {
        type: Date,
        default: null,
    },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
        transform(_doc, ret) {
            ret['id'] = String(ret['_id']);
            delete ret['_id'];
            delete ret['__v'];
            delete ret['password_hash'];
            return ret;
        },
    },
});
export const User = mongoose.models['User'] || mongoose.model('User', UserSchema);
