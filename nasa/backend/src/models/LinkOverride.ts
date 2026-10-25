/**
 * @module LinkOverride
 * Mongoose model for administrative comms-link overrides (Part 2e / F070).
 *
 * An active override lets mission control force a specific delay or blackout state,
 * temporarily bypassing the computed link model (e.g. for training exercises or
 * to simulate a degraded link scenario).
 *
 * Only one override per direction is expected to be active at a time.
 * New overrides overwrite the previous one for the same direction.
 */

import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface ILinkOverride extends Document {
  /** Comms direction this override applies to */
  direction: 'uplink' | 'downlink';
  /** Force a specific one-way delay in ms; undefined = do not force */
  force_delay_ms: number | undefined;
  /** Force blackout state; undefined = do not force */
  force_blackout: boolean | undefined;
  /** Force packet loss rate (0.0 to 1.0); undefined = do not force */
  force_packet_loss_rate: number | undefined;
  /** User ID who created this override */
  actor_id: string;
  /** Wall-clock epoch ms when this override expires; undefined = must be removed manually */
  expires_at: number | undefined;
  /** ISO timestamp when this override was created */
  created_at: Date;
}

const LinkOverrideSchema = new Schema<ILinkOverride>(
  {
    direction: {
      type: String,
      enum: ['uplink', 'downlink'],
      required: true,
      index: true,
    },
    force_delay_ms: { type: Number, default: undefined },
    force_blackout: { type: Boolean, default: undefined },
    force_packet_loss_rate: { type: Number, default: undefined },
    actor_id: { type: String, required: true },
    expires_at: { type: Number, default: undefined },
    created_at: { type: Date, default: () => new Date() },
  },
  {
    collection: 'link_overrides',
    versionKey: false,
  },
);

export const LinkOverride: Model<ILinkOverride> = mongoose.model<ILinkOverride>(
  'LinkOverride',
  LinkOverrideSchema,
);
