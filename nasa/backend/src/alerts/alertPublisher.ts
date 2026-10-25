import { EventEmitter } from 'node:events';
import { type AlertDTO } from './alertTypes.js';
import { logger } from '../core/logger.js';

export type AlertEventType = 'alert.raised' | 'alert.updated' | 'alert.cleared';

export interface AlertEvent {
  type: AlertEventType;
  alert: AlertDTO;
}

export type AlertHandler = (event: AlertEvent) => void | Promise<void>;

/**
 * Publisher interface for threshold alerts raised by the alert engine (Part 2b).
 * The bus-backed implementation (Part 2c) publishes alerts to the event bus as well.
 */
export interface AlertPublisher {
  publish(event: AlertEvent): void;
  subscribe(handler: AlertHandler): () => void;
}

/**
 * In-memory alert publisher using Node.js EventEmitter.
 * Used in tests and when the bus is not available.
 */
export class InMemoryAlertPublisher implements AlertPublisher {
  private readonly emitter = new EventEmitter();
  private static readonly EVENT_NAME = 'alert';

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  public publish(event: AlertEvent): void {
    const listeners = this.emitter.rawListeners(InMemoryAlertPublisher.EVENT_NAME);
    for (const listener of listeners) {
      try {
        const result = (listener as AlertHandler)(event);
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          (result as Promise<unknown>).catch((err) => {
            logger.error({ err }, 'Async error in alert subscriber');
          });
        }
      } catch (err) {
        logger.error({ err }, 'Synchronous exception in alert subscriber');
      }
    }
  }

  public subscribe(handler: AlertHandler): () => void {
    this.emitter.on(InMemoryAlertPublisher.EVENT_NAME, handler);
    return () => {
      this.emitter.off(InMemoryAlertPublisher.EVENT_NAME, handler);
    };
  }
}
