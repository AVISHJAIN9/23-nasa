/**
 * @module linkStore
 * MongoDB-backed store for link overrides and scheduled blackouts (Part 2e / F070).
 *
 * Provides async CRUD operations that the CommsDelayEmulator uses to load
 * and persist administrative link state changes.
 */

import { LinkOverride, type ILinkOverride } from '../models/LinkOverride.js';
import { LinkBlackout, type ILinkBlackout } from '../models/LinkBlackout.js';
import type { LinkOverrideRecord, ResolvedBlackoutWindow } from './linkTypes.js';

/**
 * Data-access interface for link overrides and scheduled blackouts.
 * Implemented against MongoDB; can be swapped for an in-memory version in tests.
 */
export interface LinkStore {
  /** Retrieve the active override for a given direction, or null if none exists. */
  getOverride(direction: 'uplink' | 'downlink'): Promise<LinkOverrideRecord | null>;

  /** Persist (upsert) a link override for a direction. Replaces any prior override. */
  setOverride(
    direction: 'uplink' | 'downlink',
    override: Omit<LinkOverrideRecord, 'created_at'>,
  ): Promise<void>;

  /** Remove an active override for a direction. No-op if none exists. */
  clearOverride(direction: 'uplink' | 'downlink'): Promise<void>;

  /** Return all currently active scheduled blackout windows for a given time. */
  getActiveBlackouts(
    wallMs: number,
    mode: 'iss' | 'moon' | 'mars',
  ): Promise<ResolvedBlackoutWindow[]>;

  /** Persist a new scheduled blackout window. Returns the persisted ID. */
  addBlackout(blackout: {
    label: string;
    startMs: number;
    endMs: number;
    mission_mode: 'iss' | 'moon' | 'mars' | null;
    direction: 'uplink' | 'downlink' | null;
    created_by: string;
  }): Promise<string>;

  /** Remove a scheduled blackout by ID. Returns false if not found. */
  removeBlackout(id: string): Promise<boolean>;
}

/**
 * MongoDB implementation of LinkStore.
 */
export class MongoLinkStore implements LinkStore {
  /**
   * Converts a Mongoose ILinkOverride document to a plain LinkOverrideRecord.
   */
  private static toRecord(doc: ILinkOverride): LinkOverrideRecord {
    return {
      created_at: doc.created_at.toISOString(),
      direction: doc.direction,
      force_delay_ms: doc.force_delay_ms,
      force_blackout: doc.force_blackout,
      force_packet_loss_rate: doc.force_packet_loss_rate,
      actor_id: doc.actor_id,
      expires_at: doc.expires_at,
    };
  }

  async getOverride(direction: 'uplink' | 'downlink'): Promise<LinkOverrideRecord | null> {
    const doc = await LinkOverride.findOne({ direction });
    if (!doc) return null;

    // Auto-skip expired overrides at read time
    if (doc.expires_at !== undefined && Date.now() > doc.expires_at) {
      await LinkOverride.deleteOne({ _id: doc._id });
      return null;
    }

    return MongoLinkStore.toRecord(doc);
  }

  async setOverride(
    direction: 'uplink' | 'downlink',
    override: Omit<LinkOverrideRecord, 'created_at'>,
  ): Promise<void> {
    await LinkOverride.findOneAndUpdate(
      { direction },
      {
        $set: {
          force_delay_ms: override.force_delay_ms,
          force_blackout: override.force_blackout,
          force_packet_loss_rate: override.force_packet_loss_rate,
          actor_id: override.actor_id,
          expires_at: override.expires_at,
          created_at: new Date(),
        },
      },
      { upsert: true },
    );
  }

  async clearOverride(direction: 'uplink' | 'downlink'): Promise<void> {
    await LinkOverride.deleteOne({ direction });
  }

  async getActiveBlackouts(
    wallMs: number,
    mode: 'iss' | 'moon' | 'mars',
  ): Promise<ResolvedBlackoutWindow[]> {
    const wallDate = new Date(wallMs);
    const docs: ILinkBlackout[] = await LinkBlackout.find({
      start_at: { $lte: wallDate },
      end_at: { $gt: wallDate },
      $or: [{ mission_mode: mode }, { mission_mode: null }],
    });

    return docs.map((doc) => ({
      label: doc.label,
      startMs: doc.start_at.getTime(),
      endMs: doc.end_at.getTime(),
    }));
  }

  async addBlackout(blackout: {
    label: string;
    startMs: number;
    endMs: number;
    mission_mode: 'iss' | 'moon' | 'mars' | null;
    direction: 'uplink' | 'downlink' | null;
    created_by: string;
  }): Promise<string> {
    const doc = await LinkBlackout.create({
      label: blackout.label,
      start_at: new Date(blackout.startMs),
      end_at: new Date(blackout.endMs),
      mission_mode: blackout.mission_mode,
      direction: blackout.direction,
      created_by: blackout.created_by,
      created_at: new Date(),
    });
    return doc.id as string;
  }

  async removeBlackout(id: string): Promise<boolean> {
    const result = await LinkBlackout.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }
}

/**
 * In-memory LinkStore for tests. No MongoDB required.
 */
export class InMemoryLinkStore implements LinkStore {
  private overrides = new Map<'uplink' | 'downlink', LinkOverrideRecord>();
  private blackouts = new Map<
    string,
    { label: string; startMs: number; endMs: number; mode: 'iss' | 'moon' | 'mars' | null }
  >();
  private nextId = 1;

  async getOverride(direction: 'uplink' | 'downlink'): Promise<LinkOverrideRecord | null> {
    const rec = this.overrides.get(direction) ?? null;
    if (rec && rec.expires_at !== undefined && Date.now() > rec.expires_at) {
      this.overrides.delete(direction);
      return null;
    }
    return rec;
  }

  async setOverride(
    direction: 'uplink' | 'downlink',
    override: Omit<LinkOverrideRecord, 'created_at'>,
  ): Promise<void> {
    this.overrides.set(direction, {
      ...override,
      created_at: new Date().toISOString(),
    });
  }

  async clearOverride(direction: 'uplink' | 'downlink'): Promise<void> {
    this.overrides.delete(direction);
  }

  async getActiveBlackouts(
    wallMs: number,
    mode: 'iss' | 'moon' | 'mars',
  ): Promise<ResolvedBlackoutWindow[]> {
    return Array.from(this.blackouts.entries())
      .filter(
        ([, b]) => b.startMs <= wallMs && wallMs < b.endMs && (b.mode === null || b.mode === mode),
      )
      .map(([, b]) => ({ label: b.label, startMs: b.startMs, endMs: b.endMs }));
  }

  async addBlackout(blackout: {
    label: string;
    startMs: number;
    endMs: number;
    mission_mode: 'iss' | 'moon' | 'mars' | null;
    direction: 'uplink' | 'downlink' | null;
    created_by: string;
  }): Promise<string> {
    const id = String(this.nextId++);
    this.blackouts.set(id, {
      label: blackout.label,
      startMs: blackout.startMs,
      endMs: blackout.endMs,
      mode: blackout.mission_mode,
    });
    return id;
  }

  async removeBlackout(id: string): Promise<boolean> {
    return this.blackouts.delete(id);
  }
}
