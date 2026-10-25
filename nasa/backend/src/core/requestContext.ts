import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestStore {
  requestId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestStore>();

/**
 * Returns the current request ID from AsyncLocalStorage, or a fallback if outside a request lifecycle.
 */
export function getRequestId(): string {
  const store = asyncLocalStorage.getStore();
  return store?.requestId ?? 'system';
}

/**
 * Runs a function within the specified request store context.
 */
export function runWithRequestContext<R>(store: RequestStore, fn: () => R): R {
  return asyncLocalStorage.run(store, fn);
}

export { asyncLocalStorage };
