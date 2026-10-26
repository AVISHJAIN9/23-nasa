import { logger } from '../core/logger.js';
/**
 * Bounded FIFO outbox for events that failed to publish to Redis.
 * Drops oldest events when capacity is exceeded to prevent memory exhaustion.
 */
export class Outbox {
    maxSize;
    queue = [];
    droppedCount = 0;
    constructor(options) {
        this.maxSize = options?.maxSize ?? 1000;
    }
    push(envelope) {
        if (this.queue.length >= this.maxSize) {
            const dropped = this.queue.shift();
            this.droppedCount += 1;
            logger.error({
                droppedCount: this.droppedCount,
                droppedUid: dropped?.uid,
                droppedType: dropped?.type,
                maxSize: this.maxSize,
            }, 'Outbox overflow: dropped oldest event');
        }
        this.queue.push(envelope);
    }
    pop() {
        return this.queue.shift();
    }
    peek() {
        return this.queue[0];
    }
    size() {
        return this.queue.length;
    }
    getDroppedCount() {
        return this.droppedCount;
    }
    clear() {
        this.queue.length = 0;
    }
}
