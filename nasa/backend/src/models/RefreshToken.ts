import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IRefreshToken extends Document {
  _id: mongoose.Types.ObjectId;
  user_id: mongoose.Types.ObjectId;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  used_at?: Date | null;
  revoked_at?: Date | null;
  created_at: Date;
}

const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
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
  },
  {
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret['id'] = String(ret['_id']);
        delete ret['_id'];
        delete ret['__v'];
        delete ret['token_hash'];
        return ret;
      },
    },
  },
);

export const RefreshToken: Model<IRefreshToken> =
  (mongoose.models['RefreshToken'] as Model<IRefreshToken>) ||
  mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema);
