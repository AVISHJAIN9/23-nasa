import { Types } from 'mongoose';
import { ValidationError, ServiceUnavailableError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { CrewProfile } from '../models/CrewProfile.js';
import { Reading } from '../models/Reading.js';
import { METRICS } from './metrics.js';
import { evaluateReading, } from './qualityEvaluator.js';
import { assertPrincipalCanWriteCrew } from './ingestAuth.js';
import { defaultMetricsRegistry } from '../core/metrics.js';
export class InMemoryCrewIdCache {
    cache = new Map();
    ttlMs;
    constructor(ttlMs = 60_000) {
        this.ttlMs = ttlMs;
    }
    has(id) {
        const entry = this.cache.get(id);
        if (!entry)
            return false;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(id);
            return false;
        }
        return true;
    }
    set(id, exists) {
        this.cache.set(id, {
            exists,
            expiresAt: Date.now() + this.ttlMs,
        });
    }
    async checkExists(id) {
        const entry = this.cache.get(id);
        if (entry && Date.now() <= entry.expiresAt) {
            return entry.exists;
        }
        try {
            const exists = (await CrewProfile.exists({ _id: id })) !== null;
            this.set(id, exists);
            return exists;
        }
        catch {
            return false;
        }
    }
    clear() {
        this.cache.clear();
    }
}
/**
 * Core telemetry batch ingestion service.
 * Used identically across HTTP POST /v1/telemetry and WebSocket /ingest namespace.
 */
export async function ingestBatch(batch, principal, deps) {
    const { readings, batch_id } = batch;
    const received = readings.length;
    defaultMetricsRegistry.recordTelemetryIngest(received);
    const crewCache = deps.crewIdCache ?? new InMemoryCrewIdCache();
    // 1. Authorize principal for all submitted crews
    const submittedCrewIds = Array.from(new Set(readings.map((r) => r.crew_id)));
    assertPrincipalCanWriteCrew(principal, submittedCrewIds);
    // 2. Validate crew profile existence with 60s memory caching
    const rejected = [];
    const validCandidates = [];
    // Batch-resolve unknown crew IDs
    const unknownIds = submittedCrewIds.filter((id) => !crewCache.has(id));
    if (unknownIds.length > 0) {
        const foundProfiles = await CrewProfile.find({
            _id: { $in: unknownIds.map((id) => new Types.ObjectId(id)) },
        }).select('_id');
        const foundIdSet = new Set(foundProfiles.map((p) => p._id.toString()));
        for (const id of unknownIds) {
            crewCache.set(id, foundIdSet.has(id));
        }
    }
    for (let i = 0; i < readings.length; i++) {
        const r = readings[i];
        const exists = await crewCache.checkExists(r.crew_id);
        if (!exists) {
            rejected.push({
                index: i,
                code: 'CREW_NOT_FOUND',
                message: `Crew profile "${r.crew_id}" does not exist`,
            });
        }
        else {
            validCandidates.push({
                index: i,
                reading: {
                    crew_id: r.crew_id,
                    metric: r.metric,
                    value: r.value,
                    unit: r.unit ?? METRICS[r.metric]?.unit,
                    timestamp: new Date(r.timestamp),
                    source: r.source,
                    dataset_id: r.dataset_id,
                    device_id: r.device_id,
                    mission_day: r.mission_day,
                    batch_id,
                },
            });
        }
    }
    // If EVERY reading was rejected, return 422 VALIDATION_ERROR with list in details
    if (rejected.length === received && received > 0) {
        throw new ValidationError('All readings in batch rejected due to invalid crew profiles', rejected.map((rej) => ({
            field: `readings.${rej.index}.crew_id`,
            issue: rej.message,
        })));
    }
    // 3. In-batch deduplication: collapse identical (crew_id, metric, timestamp) to one (last wins)
    let duplicates_in_batch = 0;
    const dedupedMap = new Map();
    for (const item of validCandidates) {
        const r = item.reading;
        const dedupKey = `${r.crew_id}:${r.metric}:${r.timestamp.toISOString()}`;
        if (dedupedMap.has(dedupKey)) {
            duplicates_in_batch++;
        }
        dedupedMap.set(dedupKey, r);
    }
    const dedupedReadings = Array.from(dedupedMap.values());
    // 4. Group by stream (crew_id + metric) and evaluate in reading timestamp order
    const streamMap = new Map();
    for (const r of dedupedReadings) {
        const streamKey = `${r.crew_id}:${r.metric}`;
        let list = streamMap.get(streamKey);
        if (!list) {
            list = [];
            streamMap.set(streamKey, list);
        }
        list.push(r);
    }
    const evaluatedReadings = [];
    const interpolatedReadings = [];
    const detectedGaps = [];
    const ingestedAt = new Date();
    for (const streamReadings of streamMap.values()) {
        // Sort chronologically by reading timestamp
        streamReadings.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const first = streamReadings[0];
        const metricDef = METRICS[first.metric];
        const qualityConfig = metricDef?.qualityConfig;
        if (!qualityConfig)
            continue;
        let streamState = await deps.qualityStateStore.getState(first.crew_id, first.metric);
        for (const r of streamReadings) {
            const result = evaluateReading(r, streamState, qualityConfig, {
                expected_interval_s: deps.settings.telemetry_expected_interval_s,
                max_interp_gap_s: deps.settings.telemetry_max_interp_gap_s,
            }, ingestedAt);
            streamState = result.nextState;
            evaluatedReadings.push(result.reading);
            if (result.interpolated.length > 0) {
                interpolatedReadings.push(...result.interpolated);
            }
            if (result.gap && detectedGaps.length < 20) {
                detectedGaps.push(result.gap);
            }
        }
        if (streamState) {
            await deps.qualityStateStore.setState(first.crew_id, first.metric, streamState);
        }
    }
    // 5. Tally quality statistics
    const by_flag = {
        dropout: 0,
        implausible: 0,
        flatline: 0,
        spike: 0,
        interpolated: 0,
        ok: 0,
    };
    for (const r of evaluatedReadings) {
        by_flag[r.quality.flag]++;
    }
    for (const r of interpolatedReadings) {
        by_flag[r.quality.flag]++;
    }
    const totalFlagged = by_flag.dropout + by_flag.implausible + by_flag.flatline + by_flag.spike + by_flag.interpolated;
    // 6. Fast persistence with single insertMany({ ordered: false })
    const allStoredReadings = [...evaluatedReadings, ...interpolatedReadings];
    if (allStoredReadings.length > 0) {
        const mongoDocs = allStoredReadings.map((r) => ({
            timestamp: r.timestamp,
            meta: {
                crew_id: new Types.ObjectId(r.crew_id),
                metric: r.metric,
                source: r.source,
            },
            value: r.value,
            unit: r.unit,
            quality: r.quality,
            mission_day: r.mission_day,
            device_id: r.device_id,
            dataset_id: r.dataset_id,
            batch_id: r.batch_id,
            ingested_at: r.ingested_at,
        }));
        try {
            await Reading.insertMany(mongoDocs, { ordered: false });
        }
        catch (err) {
            logger.error({ err, batch_id }, 'Failed to insert telemetry batch into MongoDB');
            throw new ServiceUnavailableError('Database failure during telemetry storage');
        }
    }
    // 7. Publish to subscribers (extension point for 2b threshold alerts and 2c live dashboard)
    deps.publisher.publish({
        batch_id,
        readings: allStoredReadings,
    });
    const response = {
        batch_id,
        received,
        accepted: evaluatedReadings.length,
        rejected,
        duplicates_in_batch,
        interpolated: interpolatedReadings.length,
        gaps: detectedGaps.slice(0, 20),
        quality: {
            ok: by_flag.ok,
            flagged: totalFlagged,
            by_flag: {
                dropout: by_flag.dropout,
                implausible: by_flag.implausible,
                flatline: by_flag.flatline,
                spike: by_flag.spike,
                interpolated: by_flag.interpolated,
            },
        },
    };
    logger.debug({
        batch_id,
        received,
        accepted: response.accepted,
        rejected: rejected.length,
        duplicates_in_batch,
        interpolated: response.interpolated,
    }, 'Telemetry batch ingested successfully');
    return response;
}
