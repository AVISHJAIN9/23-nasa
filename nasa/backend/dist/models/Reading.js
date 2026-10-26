import mongoose, { Schema } from 'mongoose';
import { defaultReadinessRegistry } from '../core/readiness.js';
import { logger } from '../core/logger.js';
const ReadingQualitySchema = new Schema({
    flag: {
        type: String,
        required: true,
        enum: ['ok', 'dropout', 'implausible', 'flatline', 'spike', 'interpolated'],
    },
    reasons: {
        type: [String],
        default: [],
    },
}, { _id: false });
const ReadingMetaSchema = new Schema({
    crew_id: {
        type: Schema.Types.ObjectId,
        ref: 'CrewProfile',
        required: true,
    },
    metric: {
        type: String,
        required: true,
    },
    source: {
        type: String,
        required: true,
        enum: ['simulated', 'replayed_dataset', 'real_device'],
    },
}, { _id: false });
const ReadingSchema = new Schema({
    timestamp: {
        type: Date,
        required: true,
    },
    meta: {
        type: ReadingMetaSchema,
        required: true,
    },
    value: {
        type: Number,
        default: null,
    },
    unit: {
        type: String,
        required: false,
    },
    quality: {
        type: ReadingQualitySchema,
        required: true,
    },
    mission_day: {
        type: Number,
        required: false,
    },
    device_id: {
        type: String,
        required: false,
    },
    dataset_id: {
        type: String,
        required: false,
    },
    batch_id: {
        type: String,
        required: false,
    },
    ingested_at: {
        type: Date,
        default: Date.now,
    },
}, {
    timeseries: {
        timeField: 'timestamp',
        metaField: 'meta',
        granularity: 'seconds',
    },
    autoCreate: false, // Explicitly created via ensureReadingsCollection
    autoIndex: false,
});
export const Reading = mongoose.models['Reading'] ||
    mongoose.model('Reading', ReadingSchema, 'readings');
/**
 * Ensures that the MongoDB "readings" collection exists as a time-series collection.
 * Fails with a descriptive error if the collection already exists as a non-time-series collection.
 *
 * NOTE: MongoDB time-series collections do NOT support unique compound indexes.
 * Deduplication is enforced at the application layer via IdempotencyStore and in-batch deduplication.
 */
export async function ensureReadingsCollection(retentionDays = 0, registry = defaultReadinessRegistry) {
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error('Database connection must be established before ensuring readings collection');
    }
    const collections = await db.listCollections({ name: 'readings' }).toArray();
    if (collections.length === 0) {
        const createOptions = {
            timeseries: {
                timeField: 'timestamp',
                metaField: 'meta',
                granularity: 'seconds',
            },
        };
        if (retentionDays > 0) {
            createOptions['expireAfterSeconds'] = retentionDays * 86400;
        }
        try {
            await db.createCollection('readings', createOptions);
            logger.info({ retentionDays }, 'Created time-series collection "readings" successfully');
        }
        catch (err) {
            // If collection was concurrently created, verify it
            const current = await db.listCollections({ name: 'readings' }).toArray();
            if (current.length === 0) {
                throw err;
            }
        }
    }
    else {
        const existing = collections[0];
        const isTimeseries = existing.type === 'timeseries' || existing.options?.timeseries !== undefined;
        if (!isTimeseries) {
            throw new Error('Collection "readings" exists but is not a MongoDB time-series collection. ' +
                'Time-series collections require timeField and metaField. Please drop or migrate the existing collection.');
        }
    }
    // Create compound index on meta and timestamp for fast range & latest queries
    try {
        await db
            .collection('readings')
            .createIndex({ 'meta.crew_id': 1, 'meta.metric': 1, timestamp: -1 }, { background: true });
    }
    catch {
        // Index may already exist
    }
    // Register telemetry_store readiness check
    registry.registerCheck('telemetry_store', async () => {
        if (!mongoose.connection.db) {
            return { ok: false, message: 'MongoDB connection not initialized' };
        }
        const checkColl = await mongoose.connection.db.listCollections({ name: 'readings' }).toArray();
        if (checkColl.length === 0) {
            return { ok: false, message: 'Readings collection does not exist' };
        }
        const info = checkColl[0];
        const ok = info.type === 'timeseries' || info.options?.timeseries !== undefined;
        return {
            ok,
            message: ok
                ? 'Readings time-series collection is healthy'
                : 'Readings collection is not a time-series collection',
        };
    });
}
