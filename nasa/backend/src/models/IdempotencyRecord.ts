import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type IdempotencyStatus = 'processing' | 'done';

export interface IIdempotencyRecord {
  scope: string;
  key: string;
  request_hash: string;
  status: IdempotencyStatus;
  response?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export type IdempotencyRecordDocument = IIdempotencyRecord & Document;

const IdempotencyRecordSchema = new Schema<IIdempotencyRecord>(
  {
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
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

// Compound unique index ensuring only one record per scope + key
IdempotencyRecordSchema.index({ scope: 1, key: 1 }, { unique: true });

// TTL index on created_at
IdempotencyRecordSchema.index({ created_at: 1 }, { expireAfterSeconds: 24 * 3600 });

export const IdempotencyRecord: Model<IIdempotencyRecord> =
  (mongoose.models['IdempotencyRecord'] as Model<IIdempotencyRecord>) ||
  mongoose.model<IIdempotencyRecord>(
    'IdempotencyRecord',
    IdempotencyRecordSchema,
    'idempotency_records',
  );
