import { randomUUID } from 'node:crypto';
import { EPHEMERAL_TOPICS, compareStreamIds, } from './eventTypes.js';
/**
 * In-memory EventBus implementation using a bounded ring buffer.
 * Default bus for unit tests and local development when Redis is disabled.
 */
export class MemoryEventBus {
    maxLen;
    defaultMissionMode;
    buffer = [];
    totalTrimmed = 0;
    lastTimestampMs = 0;
    currentSeq = 0;
    subscribers = new Map();
    closed = false;
    constructor(options) {
        this.maxLen = options?.maxLen ?? 10000;
        this.defaultMissionMode = options?.missionMode ?? 'mars';
    }
    generateId() {
        const nowMs = Date.now();
        if (nowMs === this.lastTimestampMs) {
            this.currentSeq += 1;
        }
        else {
            this.lastTimestampMs = nowMs;
            this.currentSeq = 0;
        }
        return `${nowMs}-${this.currentSeq}`;
    }
    async publish(event) {
        if (this.closed) {
            return { uid: event.uid ?? randomUUID(), id: null, bus: 'degraded' };
        }
        const uid = event.uid ?? randomUUID();
        const isEphemeral = EPHEMERAL_TOPICS.includes(event.topic);
        const id = isEphemeral ? null : this.generateId();
        const envelope = {
            uid,
            id,
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
        if (!isEphemeral && id !== null) {
            if (this.buffer.length >= this.maxLen) {
                this.buffer.shift();
                this.totalTrimmed += 1;
            }
            this.buffer.push(envelope);
        }
        // Deliver immediately to local subscribers
        for (const sub of this.subscribers.values()) {
            if (!sub.topics || sub.topics.has(envelope.topic)) {
                try {
                    sub.handler(envelope);
                }
                catch {
                    // Subscribers must not crash the publish pipeline
                }
            }
        }
        return {
            uid,
            id,
            bus: 'ok',
        };
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
        const headId = this.buffer.length > 0 ? (this.buffer[this.buffer.length - 1]?.id ?? null) : null;
        if (afterId === null) {
            return {
                events: [],
                truncated: false,
                reset: false,
                head_id: headId,
            };
        }
        // Check if afterId is newer than the newest event in the buffer
        if (headId !== null && compareStreamIds(afterId, headId) > 0) {
            return {
                events: [],
                truncated: false,
                reset: true,
                head_id: headId,
            };
        }
        let isTruncated = false;
        // Check if afterId is older than the oldest remaining entry and trimming has occurred
        if (this.totalTrimmed > 0 &&
            this.buffer.length > 0 &&
            compareStreamIds(afterId, this.buffer[0].id) < 0) {
            isTruncated = true;
        }
        const matchedEvents = [];
        for (const event of this.buffer) {
            if (event.id && compareStreamIds(event.id, afterId) > 0) {
                if (opts.filter(event)) {
                    matchedEvents.push(event);
                }
            }
        }
        const eventsToReturn = matchedEvents.slice(0, opts.limit);
        if (matchedEvents.length > opts.limit) {
            isTruncated = true;
        }
        return {
            events: eventsToReturn,
            truncated: isTruncated,
            reset: false,
            head_id: headId,
        };
    }
    info() {
        const headId = this.buffer.length > 0 ? (this.buffer[this.buffer.length - 1]?.id ?? null) : null;
        return {
            driver: 'memory',
            connected: !this.closed,
            stream_length: this.buffer.length,
            head_id: headId,
            outbox_size: 0,
            subscriber_count: this.subscribers.size,
            degraded: false,
        };
    }
    async close() {
        this.closed = true;
        this.subscribers.clear();
    }
}
