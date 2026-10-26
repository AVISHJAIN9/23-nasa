import mongoose, { Schema } from 'mongoose';
const AuditLogSchema = new Schema({
    sequence_number: {
        type: Number,
        required: true,
        unique: true,
        index: true,
    },
    prev_hash: {
        type: String,
        required: true,
        index: true,
    },
    hash: {
        type: String,
        required: true,
        index: true,
    },
    actor_id: {
        type: String,
        required: true,
        index: true,
    },
    action: {
        type: String,
        required: true,
        index: true,
    },
    target_id: {
        type: String,
        required: true,
        index: true,
    },
    at: {
        type: Date,
        default: Date.now,
        index: true,
    },
    request_id: {
        type: String,
        default: '',
    },
    metadata: {
        type: Schema.Types.Mixed,
        default: () => ({}),
    },
}, {
    collection: 'audit_log',
    toJSON: {
        transform(_doc, ret) {
            ret['id'] = String(ret['_id']);
            delete ret['_id'];
            delete ret['__v'];
            return ret;
        },
    },
});
export const AuditLog = mongoose.models['AuditLog'] ||
    mongoose.model('AuditLog', AuditLogSchema);
