/**
 * @module LinkEvent
 * Mongoose model for persisted link state-change events (Part 2e / F070).
 *
 * LinkWatcher writes a record whenever the link state transitions
 * (e.g. blackout starts/ends, delay band changes, override applied/removed).
 * Used by GET /v1/link/events for replay and audit.
 */

import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type LinkEventKind =
  | 'blackout_started'
  | 'blackout_ended'
  | 'delay_changed'
  | 'override_applied'
  | 'override_removed'
  | 'state_evaluated';

export interface ILinkEvent extends Document {
  /** Event kind for filtering */
  kind: LinkEventKind;
  /** Mission mode in effect at event time */
  mission_mode: 'iss' | 'moon' | 'mars';
  /** Effective one-way delay ms at this event */
  delay_ms: number;
  /** Whether link was in blackout at this event */
  in_blackout: boolean;
  /** Blackout window label if in_blackout is true */
  blackout_label: string | null;
  /** Whether an admin override was active */
  override_active: boolean;
  /** Wall-clock timestamp of this event */
  occurred_at: Date;
}

const LinkEventSchema = new Schema<ILinkEvent>(
  {
    kind: {
      type: String,
      enum: [
        'blackout_started',
        'blackout_ended',
        'delay_changed',
        'override_applied',
        'override_removed',
        'state_evaluated',
      ] as const,
      required: true,
      index: true,
    },
    mission_mode: {
      type: String,
      enum: ['iss', 'moon', 'mars'],
      required: true,
    },
    delay_ms: { type: Number, required: true },
    in_blackout: { type: Boolean, required: true },
    blackout_label: { type: String, default: null },
    override_active: { type: Boolean, required: true },
    occurred_at: { type: Date, required: true },
  },
  {
    collection: 'link_events',
    versionKey: false,
  },
);

// TTL: retain link events for 30 days (2592000 seconds)
LinkEventSchema.index({ occurred_at: 1 }, { expireAfterSeconds: 2_592_000 });

export const LinkEvent: Model<ILinkEvent> = mongoose.model<ILinkEvent>(
  'LinkEvent',
  LinkEventSchema,
);
