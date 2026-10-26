import { randomUUID } from 'node:crypto';
import { EPHEMERAL_TOPICS, compareStreamIds, } from './eventTypes.js';
import { createRedisClient } from './redisClient.js';
import { Outbox } from './outbox.js';
import { logger } from '../core/logger.js';
export class RedisEventBus {
    redisUrl;
    streamKey;
    telemetryChannel;
    streamMaxlen;
    defaultMissionMode;
    pubClient;
    readerClient;
    subClient;
    outbox;
    subscribers = new Map();
    lastDeliveredId = null;
    isReading = false;
    isFlushing = false;
    closed = false;
    flushTimer = null;
    constructor(options) {
        this.redisUrl = options.redisUrl;
        const prefix = options.keyPrefix ?? 'astro:';
        this.streamKey = `${prefix}events`;
        this.telemetryChannel = `${prefix}live:telemetry`;
        this.streamMaxlen = options.streamMaxlen ?? 10000;
        this.defaultMissionMode = options.missionMode ?? 'mars';
        this.outbox = new Outbox({ maxSize: options.outboxMax ?? 1000 });
        // Client for general commands and XADD (fails fast if disconnected)
        this.pubClient = createRedisClient(this.redisUrl, {
            name: 'bus-pub',
            enableOfflineQueue: false,
        });
        // Dedicated client for blocking reader
        this.readerClient = createRedisClient(this.redisUrl, {
            name: 'bus-reader',
            enableOfflineQueue: true,
        });
        // Dedicated client for pub/sub subscriptions
        this.subClient = createRedisClient(this.redisUrl, {
            name: 'bus-sub',
            enableOfflineQueue: true,
        });
        this.setupPubSub();
        this.startReaderLoop();
        this.startOutboxFlusher();
    }
    setupPubSub() {
        this.subClient.subscribe(this.telemetryChannel, (err) => {
            if (err) {
                logger.warn({ err: err.message }, 'Failed to subscribe to telemetry pub/sub channel');
            }
        });
        this.subClient.on('message', (channel, message) => {
            if (channel === this.telemetryChannel) {
                try {
                    const envelope = JSON.parse(message);
                    this.fanOut(envelope);
                }
                catch {
                    // ignore malformed message
                }
            }
        });
    }
    startOutboxFlusher() {
        this.pubClient.on('ready', () => {
            void this.flushOutbox();
        });
        this.flushTimer = setInterval(() => {
            if (!this.closed && this.outbox.size() > 0) {
                void this.flushOutbox();
            }
        }, 1000);
    }
    async flushOutbox() {
        if (this.isFlushing || this.closed || this.outbox.size() === 0)
            return;
        this.isFlushing = true;
        try {
            while (this.outbox.size() > 0 && !this.closed) {
                const item = this.outbox.peek();
                if (!item)
                    break;
                const payloadStr = JSON.stringify(item);
                // XADD to stream
                const id = await this.pubClient.xadd(this.streamKey, 'MAXLEN', '~', this.streamMaxlen, '*', 'data', payloadStr);
                if (id) {
                    // successfully stored in Redis stream
                    this.outbox.pop();
                }
                else {
                    break;
                }
            }
        }
        catch {
            // Redis might still be unavailable; will retry on next tick
        }
        finally {
            this.isFlushing = false;
        }
    }
    fanOut(envelope) {
        for (const sub of this.subscribers.values()) {
            if (!sub.topics || sub.topics.has(envelope.topic)) {
                try {
                    sub.handler(envelope);
                }
                catch {
                    // Ignore subscriber errors
                }
            }
        }
    }
    async startReaderLoop() {
        if (this.isReading || this.closed)
            return;
        this.isReading = true;
        let currentReadId = '$';
        while (!this.closed) {
            try {
                if (this.lastDeliveredId !== null) {
                    currentReadId = this.lastDeliveredId;
                }
                // XREAD BLOCK 2000 STREAMS streamKey currentReadId
                const results = (await this.readerClient.xread('BLOCK', 2000, 'STREAMS', this.streamKey, currentReadId));
                if (results && results.length > 0) {
                    for (const streamResult of results) {
                        const entries = streamResult[1];
                        for (const [id, fields] of entries) {
                            if (this.lastDeliveredId !== null &&
                                compareStreamIds(id, this.lastDeliveredId) <= 0) {
                                continue;
                            }
                            this.lastDeliveredId = id;
                            currentReadId = id;
                            // Parse field 'data'
                            let dataJson = null;
                            for (let i = 0; i < fields.length; i += 2) {
                                if (fields[i] === 'data') {
                                    dataJson = fields[i + 1] ?? null;
                                    break;
                                }
                            }
                            if (dataJson) {
                                try {
                                    const raw = JSON.parse(dataJson);
                                    const envelope = {
                                        ...raw,
                                        id, // assigned stream ID
                                    };
                                    this.fanOut(envelope);
                                }
                                catch {
                                    // Malformed envelope in stream; ignore
                                }
                            }
                        }
                    }
                }
            }
            catch {
                if (this.closed)
                    break;
                // Reader loop error (e.g. connection dropped) -> wait briefly and loop
                await new Promise((res) => setTimeout(res, 500));
            }
        }
        this.isReading = false;
    }
    async publish(event) {
        const uid = event.uid ?? randomUUID();
        const isEphemeral = EPHEMERAL_TOPICS.includes(event.topic);
        const envelope = {
            uid,
            id: null,
            topic: event.topic,
            type: event.type,
            crew_id: event.crew_id ?? null,
            severity: event.severity ?? null,
            audience: event.audience ?? 'all',
            emitted_at: event.emitted_at ?? new Date().toISOString(),
            mission_mode: event.mission_mode ?? this.defaultMissionMode,
            request_id: event.request_id ?? null,
            payload: event.payload,
        };
        if (isEphemeral) {
            // Ephemeral topic (telemetry): fan out locally immediately and publish to Redis pub/sub
            this.fanOut(envelope);
            try {
                await this.pubClient.publish(this.telemetryChannel, JSON.stringify(envelope));
                return { uid, id: null, bus: 'ok' };
            }
            catch {
                return { uid, id: null, bus: 'degraded' };
            }
        }
        // Replayable topic (alerts, emergency, system)
        try {
            const payloadStr = JSON.stringify(envelope);
            const streamId = await this.pubClient.xadd(this.streamKey, 'MAXLEN', '~', this.streamMaxlen, '*', 'data', payloadStr);
            return {
                uid,
                id: streamId,
                bus: 'ok',
            };
        }
        catch {
            // Degraded mode: deliver to local subscribers immediately with id: null, queue in outbox
            this.fanOut(envelope);
            this.outbox.push(envelope);
            return {
                uid,
                id: null,
                bus: 'degraded',
            };
        }
    }
    subscribe(handler, opts) {
        const subId = randomUUID();
        this.subscribers.set(subId, {
            handler,
            topics: opts?.topics ? new Set(opts.topics) : undefined,
        });
        return () => {
            this.subscribers.delete(subId);
        };
    }
    async replay(afterId, opts) {
        try {
            // 1. Get current head_id via XREVRANGE
            const headEntries = (await this.pubClient.xrevrange(this.streamKey, '+', '-', 'COUNT', 1));
            const headId = headEntries && headEntries.length > 0 ? (headEntries[0]?.[0] ?? null) : null;
            if (afterId === null) {
                return {
                    events: [],
                    truncated: false,
                    reset: false,
                    head_id: headId,
                };
            }
            // Check if afterId is newer than head_id
            if (headId !== null && compareStreamIds(afterId, headId) > 0) {
                return {
                    events: [],
                    truncated: false,
                    reset: true,
                    head_id: headId,
                };
            }
            // Check earliest remaining entry in stream
            const earliestEntries = (await this.pubClient.xrange(this.streamKey, '-', '+', 'COUNT', 1));
            let truncated = false;
            if (earliestEntries && earliestEntries.length > 0) {
                const earliestId = earliestEntries[0]?.[0];
                if (earliestId && compareStreamIds(afterId, earliestId) < 0) {
                    truncated = true;
                }
            }
            // Read pages of 200 items using XRANGE
            const matchedEvents = [];
            let currentStartId = afterId;
            let hasMoreInStream = true;
            const pageSize = 200;
            while (hasMoreInStream && matchedEvents.length <= opts.limit) {
                const entries = (await this.pubClient.xrange(this.streamKey, currentStartId, '+', 'COUNT', pageSize));
                if (!entries || entries.length === 0) {
                    hasMoreInStream = false;
                    break;
                }
                for (const [id, fields] of entries) {
                    if (compareStreamIds(id, afterId) <= 0) {
                        continue;
                    }
                    let dataJson = null;
                    for (let i = 0; i < fields.length; i += 2) {
                        if (fields[i] === 'data') {
                            dataJson = fields[i + 1] ?? null;
                            break;
                        }
                    }
                    if (dataJson) {
                        try {
                            const raw = JSON.parse(dataJson);
                            const envelope = { ...raw, id };
                            if (opts.filter(envelope)) {
                                matchedEvents.push(envelope);
                            }
                        }
                        catch {
                            // Ignore parse error
                        }
                    }
                }
                const lastEntryId = entries[entries.length - 1]?.[0];
                if (entries.length < pageSize || !lastEntryId) {
                    hasMoreInStream = false;
                }
                else {
                    // Increment start id for next page (next id after lastEntryId)
                    currentStartId = `${lastEntryId.split('-')[0]}-${Number(lastEntryId.split('-')[1]) + 1}`;
                }
            }
            const eventsToReturn = matchedEvents.slice(0, opts.limit);
            if (matchedEvents.length > opts.limit) {
                truncated = true;
            }
            return {
                events: eventsToReturn,
                truncated,
                reset: false,
                head_id: headId,
            };
        }
        catch {
            return {
                events: [],
                truncated: false,
                reset: false,
                head_id: this.lastDeliveredId,
            };
        }
    }
    info() {
        const isReady = this.pubClient.status === 'ready';
        return {
            driver: 'redis',
            connected: isReady,
            stream_length: 0,
            head_id: this.lastDeliveredId,
            outbox_size: this.outbox.size(),
            subscriber_count: this.subscribers.size,
            degraded: !isReady || this.outbox.size() > 0,
            dropped_outbox_events: this.outbox.getDroppedCount(),
        };
    }
    async close() {
        this.closed = true;
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        this.subscribers.clear();
        try {
            await Promise.allSettled([
                this.pubClient.quit(),
                this.readerClient.quit(),
                this.subClient.quit(),
            ]);
        }
        catch {
            // Ignore closing errors
        }
    }
}
