import { EventEmitter } from 'node:events';
import { logger } from '../core/logger.js';
/**
 * In-memory telemetry publisher using Node.js EventEmitter.
 * Isolates subscribers so exceptions are caught and logged without aborting ingestion.
 */
export class InMemoryTelemetryPublisher {
    emitter = new EventEmitter();
    static EVENT_NAME = 'telemetry:batch';
    constructor() {
        this.emitter.setMaxListeners(100);
    }
    publish(event) {
        // Fire handlers asynchronously or safely without throwing
        const listeners = this.emitter.rawListeners(InMemoryTelemetryPublisher.EVENT_NAME);
        for (const listener of listeners) {
            try {
                const result = listener(event);
                if (result && typeof result.catch === 'function') {
                    result.catch((err) => {
                        logger.error({ err }, 'Async error in telemetry subscriber');
                    });
                }
            }
            catch (err) {
                logger.error({ err }, 'Synchronous exception in telemetry subscriber');
            }
        }
    }
    subscribe(handler) {
        this.emitter.on(InMemoryTelemetryPublisher.EVENT_NAME, handler);
        return () => {
            this.emitter.off(InMemoryTelemetryPublisher.EVENT_NAME, handler);
        };
    }
}
