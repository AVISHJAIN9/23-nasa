import mongoose, { Schema } from 'mongoose';
const IdempotencyRecordSchema = new Schema({
    scope: {
        type: String,
        required: true,
        index: true,
    },
    key: {
        type: String,
        required: true,
        index: true,
    },
    request_hash: {
        type: String,
        required: true,
    },
    status: {
        type: String,
        enum: ['processing', 'done'],
        required: true,
    },
    response: {
        type: Schema.Types.Mixed,
        required: false,
    },
    created_at: {
        type: Date,
        default: Date.now,
    },
    updated_at: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});
// Compound unique index ensuring only one record per scope + key
IdempotencyRecordSchema.index({ scope: 1, key: 1 }, { unique: true });
// TTL index on created_at
IdempotencyRecordSchema.index({ created_at: 1 }, { expireAfterSeconds: 24 * 3600 });
export const IdempotencyRecord = mongoose.models['IdempotencyRecord'] ||
    mongoose.model('IdempotencyRecord', IdempotencyRecordSchema, 'idempotency_records');
