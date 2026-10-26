import { InMemoryAlertPublisher, } from '../alerts/alertPublisher.js';
import { logger } from '../core/logger.js';
/**
 * AlertPublisher implementation that notifies local in-process subscribers
 * and fans out the alert to the real-time EventBus.
 * Failures in bus publishing never impact the alert engine.
 */
export class BusAlertPublisher {
    localPublisher = new InMemoryAlertPublisher();
    bus;
    constructor(bus) {
        this.bus = bus;
    }
    publish(event) {
        // 1. Notify local subscribers synchronously
        try {
            this.localPublisher.publish(event);
        }
        catch (err) {
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
            payload: event.alert,
        })
            .catch((err) => {
            logger.warn({ err: err.message }, 'Failed to publish alert to event bus');
        });
    }
    subscribe(handler) {
        return this.localPublisher.subscribe(handler);
    }
}
