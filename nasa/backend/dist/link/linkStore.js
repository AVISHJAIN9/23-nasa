/**
 * @module linkStore
 * MongoDB-backed store for link overrides and scheduled blackouts (Part 2e / F070).
 *
 * Provides async CRUD operations that the CommsDelayEmulator uses to load
 * and persist administrative link state changes.
 */
import { LinkOverride } from '../models/LinkOverride.js';
import { LinkBlackout } from '../models/LinkBlackout.js';
/**
 * MongoDB implementation of LinkStore.
 */
export class MongoLinkStore {
    /**
     * Converts a Mongoose ILinkOverride document to a plain LinkOverrideRecord.
     */
    static toRecord(doc) {
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
    async getOverride(direction) {
        const doc = await LinkOverride.findOne({ direction });
        if (!doc)
            return null;
        // Auto-skip expired overrides at read time
        if (doc.expires_at !== undefined && Date.now() > doc.expires_at) {
            await LinkOverride.deleteOne({ _id: doc._id });
            return null;
        }
        return MongoLinkStore.toRecord(doc);
    }
    async setOverride(direction, override) {
        await LinkOverride.findOneAndUpdate({ direction }, {
            $set: {
                force_delay_ms: override.force_delay_ms,
                force_blackout: override.force_blackout,
                force_packet_loss_rate: override.force_packet_loss_rate,
                actor_id: override.actor_id,
                expires_at: override.expires_at,
                created_at: new Date(),
            },
        }, { upsert: true });
    }
    async clearOverride(direction) {
        await LinkOverride.deleteOne({ direction });
    }
    async getActiveBlackouts(wallMs, mode) {
        const wallDate = new Date(wallMs);
        const docs = await LinkBlackout.find({
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
    async addBlackout(blackout) {
        const doc = await LinkBlackout.create({
            label: blackout.label,
            start_at: new Date(blackout.startMs),
            end_at: new Date(blackout.endMs),
            mission_mode: blackout.mission_mode,
            direction: blackout.direction,
            created_by: blackout.created_by,
            created_at: new Date(),
        });
        return doc.id;
    }
    async removeBlackout(id) {
        const result = await LinkBlackout.deleteOne({ _id: id });
        return result.deletedCount > 0;
    }
}
/**
 * In-memory LinkStore for tests. No MongoDB required.
 */
export class InMemoryLinkStore {
    overrides = new Map();
    blackouts = new Map();
    nextId = 1;
    async getOverride(direction) {
        const rec = this.overrides.get(direction) ?? null;
        if (rec && rec.expires_at !== undefined && Date.now() > rec.expires_at) {
            this.overrides.delete(direction);
            return null;
        }
        return rec;
    }
    async setOverride(direction, override) {
        this.overrides.set(direction, {
            ...override,
            created_at: new Date().toISOString(),
        });
    }
    async clearOverride(direction) {
        this.overrides.delete(direction);
    }
    async getActiveBlackouts(wallMs, mode) {
        return Array.from(this.blackouts.entries())
            .filter(([, b]) => b.startMs <= wallMs && wallMs < b.endMs && (b.mode === null || b.mode === mode))
            .map(([, b]) => ({ label: b.label, startMs: b.startMs, endMs: b.endMs }));
    }
    async addBlackout(blackout) {
        const id = String(this.nextId++);
        this.blackouts.set(id, {
            label: blackout.label,
            startMs: blackout.startMs,
            endMs: blackout.endMs,
            mode: blackout.mission_mode,
        });
        return id;
    }
    async removeBlackout(id) {
        return this.blackouts.delete(id);
    }
}
