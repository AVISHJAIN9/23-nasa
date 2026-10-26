import { AsyncLocalStorage } from 'node:async_hooks';
const asyncLocalStorage = new AsyncLocalStorage();
/**
 * Returns the current request ID from AsyncLocalStorage, or a fallback if outside a request lifecycle.
 */
export function getRequestId() {
    const store = asyncLocalStorage.getStore();
    return store?.requestId ?? 'system';
}
/**
 * Runs a function within the specified request store context.
 */
export function runWithRequestContext(store, fn) {
    return asyncLocalStorage.run(store, fn);
}
export { asyncLocalStorage };
