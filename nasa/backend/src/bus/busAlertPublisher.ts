import {
  type AlertEvent,
  type AlertHandler,
  type AlertPublisher,
  InMemoryAlertPublisher,
} from '../alerts/alertPublisher.js';
import { type EventBus } from './eventBus.js';
import { logger } from '../core/logger.js';

/**
 * AlertPublisher implementation that notifies local in-process subscribers
 * and fans out the alert to the real-time EventBus.
 * Failures in bus publishing never impact the alert engine.
 */
export class BusAlertPublisher implements AlertPublisher {
  private readonly localPublisher = new InMemoryAlertPublisher();
  private readonly bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  public publish(event: AlertEvent): void {
    // 1. Notify local subscribers synchronously
    try {
      this.localPublisher.publish(event);
    } catch (err) {
      logger.error({ err }, 'Error in local alert publisher subscriber');
    }

    // 2. Publish to the event bus asynchronously
    void this.bus
      .publish({
        topic: 'alerts',
        type: event.type,
        crew_id: event.alert.crew_id,
        severity: event.alert.severity,
        audience: 'all',
        payload: event.alert as unknown as Record<string, unknown>,
      })
      .catch((err) => {
        logger.warn({ err: (err as Error).message }, 'Failed to publish alert to event bus');
      });
  }

  public subscribe(handler: AlertHandler): () => void {
    return this.localPublisher.subscribe(handler);
  }
}
