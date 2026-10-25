import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IAuditLog extends Document {
  _id: mongoose.Types.ObjectId;
  sequence_number: number;
  prev_hash: string;
  hash: string;
  actor_id: string;
  action: string;
  target_id: string;
  at: Date;
  request_id: string;
  metadata?: Record<string, unknown>;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
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
  },
  {
    collection: 'audit_log',
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret['id'] = String(ret['_id']);
        delete ret['_id'];
        delete ret['__v'];
        return ret;
      },
    },
  },
);

export const AuditLog: Model<IAuditLog> =
  (mongoose.models['AuditLog'] as Model<IAuditLog>) ||
  mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
