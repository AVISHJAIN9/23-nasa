import { type Envelope } from './eventTypes.js';
import { logger } from '../core/logger.js';

export interface OutboxOptions {
  maxSize?: number;
}

/**
 * Bounded FIFO outbox for events that failed to publish to Redis.
 * Drops oldest events when capacity is exceeded to prevent memory exhaustion.
 */
export class Outbox {
  private readonly maxSize: number;
  private readonly queue: Envelope[] = [];
  private droppedCount = 0;

  constructor(options?: OutboxOptions) {
    this.maxSize = options?.maxSize ?? 1000;
  }

  public push(envelope: Envelope): void {
    if (this.queue.length >= this.maxSize) {
      const dropped = this.queue.shift();
      this.droppedCount += 1;
      logger.error(
        {
          droppedCount: this.droppedCount,
          droppedUid: dropped?.uid,
          droppedType: dropped?.type,
          maxSize: this.maxSize,
        },
        'Outbox overflow: dropped oldest event',
      );
    }
    this.queue.push(envelope);
  }

  public pop(): Envelope | undefined {
    return this.queue.shift();
  }

  public peek(): Envelope | undefined {
    return this.queue[0];
  }

  public size(): number {
    return this.queue.length;
  }

  public getDroppedCount(): number {
    return this.droppedCount;
  }

  public clear(): void {
    this.queue.length = 0;
  }
}
