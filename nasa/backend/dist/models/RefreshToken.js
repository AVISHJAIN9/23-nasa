import mongoose, { Schema } from 'mongoose';
const RefreshTokenSchema = new Schema({
    user_id: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    family_id: {
        type: String,
        required: true,
        index: true,
    },
    token_hash: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    expires_at: {
        type: Date,
        required: true,
        index: { expires: 0 }, // MongoDB automatic TTL deletion
    },
    used_at: {
        type: Date,
        default: null,
    },
    revoked_at: {
        type: Date,
        default: null,
    },
    created_at: {
        type: Date,
        default: Date.now,
    },
}, {
    toJSON: {
        transform(_doc, ret) {
            ret['id'] = String(ret['_id']);
            delete ret['_id'];
            delete ret['__v'];
            delete ret['token_hash'];
            return ret;
        },
    },
});
export const RefreshToken = mongoose.models['RefreshToken'] ||
    mongoose.model('RefreshToken', RefreshTokenSchema);
