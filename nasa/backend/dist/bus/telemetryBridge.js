import { logger } from '../core/logger.js';
/**
 * TelemetryBridge subscribes to the in-memory TelemetryPublisher,
 * coalesces high-frequency telemetry readings in-memory, and broadcasts
 * periodic ephemeral 'telemetry.update' events to the EventBus.
 *
 * Ingestion latency is completely unaffected: callback is strictly in-memory.
 */
export class TelemetryBridge {
    telemetryPublisher;
    bus;
    coalesceMs;
    idleEvictionMs;
    crewStates = new Map();
    dirtyCrews = new Set();
    unsubscribe = null;
    timer = null;
    running = false;
    constructor(telemetryPublisher, bus, options) {
        this.telemetryPublisher = telemetryPublisher;
        this.bus = bus;
        this.coalesceMs = options?.coalesceMs ?? 500;
        this.idleEvictionMs = options?.idleEvictionMs ?? 10 * 60 * 1000;
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        this.unsubscribe = this.telemetryPublisher.subscribe((batch) => {
            this.handleBatch(batch);
        });
        this.timer = setInterval(() => {
            void this.flush();
        }, this.coalesceMs);
    }
    stop() {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.crewStates.clear();
        this.dirtyCrews.clear();
    }
    /**
     * Strictly in-memory handler for incoming telemetry batches.
     * Does ZERO I/O to avoid slowing down the ingest path.
     */
    handleBatch(batch) {
        const now = Date.now();
        for (const reading of batch.readings) {
            const crewId = String(reading.crew_id);
            let state = this.crewStates.get(crewId);
            if (!state) {
                state = {
                    metrics: new Map(),
                    changedMetrics: new Set(),
                    latestTimestamp: reading.timestamp
                        ? new Date(reading.timestamp).toISOString()
                        : new Date().toISOString(),
                    lastActivity: now,
                };
                this.crewStates.set(crewId, state);
            }
            const isoTime = reading.timestamp
                ? new Date(reading.timestamp).toISOString()
                : new Date().toISOString();
            state.metrics.set(reading.metric, {
                value: reading.value,
                quality_flag: reading.quality?.flag ?? 'ok',
                timestamp: isoTime,
            });
            state.changedMetrics.add(reading.metric);
            state.latestTimestamp = isoTime;
            state.lastActivity = now;
            this.dirtyCrews.add(crewId);
        }
    }
    async flush() {
        if (this.dirtyCrews.size === 0) {
            this.evictIdleCrews();
            return;
        }
        const crewsToFlush = Array.from(this.dirtyCrews);
        this.dirtyCrews.clear();
        for (const crewId of crewsToFlush) {
            const state = this.crewStates.get(crewId);
            if (!state || state.changedMetrics.size === 0)
                continue;
            const valuesRecord = {};
            for (const metric of state.changedMetrics) {
                const metricVal = state.metrics.get(metric);
                if (metricVal) {
                    valuesRecord[metric] = {
                        value: metricVal.value,
                        quality_flag: metricVal.quality_flag,
                    };
                }
            }
            state.changedMetrics.clear();
            try {
                await this.bus.publish({
                    topic: 'telemetry',
                    type: 'telemetry.update',
                    crew_id: crewId,
                    audience: 'all',
                    emitted_at: new Date().toISOString(),
                    payload: {
                        crew_id: crewId,
                        timestamp: state.latestTimestamp,
                        values: valuesRecord,
                    },
                });
            }
            catch (err) {
                logger.warn({ err: err.message }, 'TelemetryBridge publish failure');
            }
        }
        this.evictIdleCrews();
    }
    evictIdleCrews() {
        const now = Date.now();
        for (const [crewId, state] of this.crewStates.entries()) {
            if (now - state.lastActivity > this.idleEvictionMs) {
                this.crewStates.delete(crewId);
            }
        }
    }
}
