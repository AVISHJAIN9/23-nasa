import { EventEmitter } from 'node:events';
import { logger } from '../core/logger.js';
/**
 * In-memory alert publisher using Node.js EventEmitter.
 * Used in tests and when the bus is not available.
 */
export class InMemoryAlertPublisher {
    emitter = new EventEmitter();
    static EVENT_NAME = 'alert';
    constructor() {
        this.emitter.setMaxListeners(100);
    }
    publish(event) {
        const listeners = this.emitter.rawListeners(InMemoryAlertPublisher.EVENT_NAME);
        for (const listener of listeners) {
            try {
                const result = listener(event);
                if (result && typeof result.catch === 'function') {
                    result.catch((err) => {
                        logger.error({ err }, 'Async error in alert subscriber');
                    });
                }
            }
            catch (err) {
                logger.error({ err }, 'Synchronous exception in alert subscriber');
            }
        }
    }
    subscribe(handler) {
        this.emitter.on(InMemoryAlertPublisher.EVENT_NAME, handler);
        return () => {
            this.emitter.off(InMemoryAlertPublisher.EVENT_NAME, handler);
        };
    }
}
