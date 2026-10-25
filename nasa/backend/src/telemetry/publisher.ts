import { EventEmitter } from 'node:events';
import { type EvaluatedReading } from './qualityEvaluator.js';
import { logger } from '../core/logger.js';

export interface TelemetryBatchEvent {
  batch_id?: string;
  readings: EvaluatedReading[];
}

export type TelemetryBatchHandler = (event: TelemetryBatchEvent) => void | Promise<void>;

export interface TelemetryPublisher {
  publish(event: TelemetryBatchEvent): void;
  subscribe(handler: TelemetryBatchHandler): () => void;
}

/**
 * In-memory telemetry publisher using Node.js EventEmitter.
 * Isolates subscribers so exceptions are caught and logged without aborting ingestion.
 */
export class InMemoryTelemetryPublisher implements TelemetryPublisher {
  private readonly emitter = new EventEmitter();
  private static readonly EVENT_NAME = 'telemetry:batch';

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  public publish(event: TelemetryBatchEvent): void {
    // Fire handlers asynchronously or safely without throwing
    const listeners = this.emitter.rawListeners(InMemoryTelemetryPublisher.EVENT_NAME);
    for (const listener of listeners) {
      try {
        const result = (listener as TelemetryBatchHandler)(event);
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          (result as Promise<unknown>).catch((err) => {
            logger.error({ err }, 'Async error in telemetry subscriber');
          });
        }
      } catch (err) {
        logger.error({ err }, 'Synchronous exception in telemetry subscriber');
      }
    }
  }

  public subscribe(handler: TelemetryBatchHandler): () => void {
    this.emitter.on(InMemoryTelemetryPublisher.EVENT_NAME, handler);
    return () => {
      this.emitter.off(InMemoryTelemetryPublisher.EVENT_NAME, handler);
    };
  }
}
