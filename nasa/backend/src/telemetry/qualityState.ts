import { type StreamQualityState } from './qualityEvaluator.js';

export interface QualityStateStore {
  getState(crewId: string, metric: string): Promise<StreamQualityState | undefined>;
  setState(crewId: string, metric: string, state: StreamQualityState): Promise<void>;
  clear(): Promise<void>;
}

export interface InMemoryQualityStateStoreOptions {
  maxEntries?: number;
  idleTtlMs?: number; // Idle eviction in wall time or reading time (default 10 min = 600,000 ms)
}

/**
 * In-memory implementation of QualityStateStore with LRU / idle eviction.
 *
 * NOTE: State is stored per-process in memory and will be cleared upon process restart.
 * A distributed Redis store implementing QualityStateStore can be swapped in for multi-replica setups.
 */
export class InMemoryQualityStateStore implements QualityStateStore {
  private readonly store = new Map<string, StreamQualityState>();
  private readonly maxEntries: number;
  private readonly idleTtlMs: number;

  constructor(options: InMemoryQualityStateStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.idleTtlMs = options.idleTtlMs ?? 10 * 60 * 1000; // 10 minutes
  }

  private getKey(crewId: string, metric: string): string {
    return `${crewId}:${metric}`;
  }

  public async getState(crewId: string, metric: string): Promise<StreamQualityState | undefined> {
    const key = this.getKey(crewId, metric);
    const entry = this.store.get(key);

    if (!entry) return undefined;

    // Check idle eviction (wall time since last activity)
    if (entry.last_activity_wall_time) {
      const now = Date.now();
      if (now - entry.last_activity_wall_time > this.idleTtlMs) {
        this.store.delete(key);
        return undefined;
      }
    }

    // Refresh LRU order by re-inserting
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  public async setState(crewId: string, metric: string, state: StreamQualityState): Promise<void> {
    const key = this.getKey(crewId, metric);

    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      // Evict oldest (first key in map iterator)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, state);
  }

  public async clear(): Promise<void> {
    this.store.clear();
  }
}
