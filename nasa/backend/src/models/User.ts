import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { ROLES, type Role } from '../core/roles.js';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  password_hash: string;
  display_name: string;
  role: Role;
  is_medical_officer: boolean;
  status: 'active' | 'disabled';
  crew_profile_id?: mongoose.Types.ObjectId;
  failed_login_count: number;
  locked_until?: Date | null;
  created_at: Date;
  updated_at: Date;
}

const UserSchema = new Schema<IUser>(
  {
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
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret['id'] = String(ret['_id']);
        delete ret['_id'];
        delete ret['__v'];
        delete ret['password_hash'];
        return ret;
      },
    },
  },
);

export const User: Model<IUser> =
  (mongoose.models['User'] as Model<IUser>) || mongoose.model<IUser>('User', UserSchema);
