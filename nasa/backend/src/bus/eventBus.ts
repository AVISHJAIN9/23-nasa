import { type Envelope, type NewEvent, type Topic } from './eventTypes.js';

export interface PublishResult {
  uid: string;
  id: string | null;
  bus: 'ok' | 'degraded';
}

export interface ReplayOptions {
  limit: number;
  filter: (e: Envelope) => boolean;
}

export interface ReplayResult {
  events: Envelope[];
  truncated: boolean;
  reset: boolean;
  head_id: string | null;
}

export interface BusInfo {
  driver: 'redis' | 'memory';
  connected: boolean;
  stream_length: number;
  head_id: string | null;
  outbox_size: number;
  subscriber_count: number;
  degraded: boolean;
  dropped_outbox_events?: number;
}

export interface EventBus {
  /**
   * Publishes an event to the bus.
   * Never throws; resolves with bus: 'degraded' when Redis/backend is unavailable.
   */
  publish(event: NewEvent): Promise<PublishResult>;

  /**
   * Subscribes to live events delivered within this process.
   * Returns an unsubscribe function.
   */
  subscribe(handler: (e: Envelope) => void, opts?: { topics?: Topic[] }): () => void;

  /**
   * Replays events occurring strictly after afterId, up to opts.limit.
   * afterId === null means "give me nothing, just return current head_id".
   */
  replay(afterId: string | null, opts: ReplayOptions): Promise<ReplayResult>;

  /**
   * Returns runtime statistics and health information for readiness checks and monitoring.
   */
  info(): BusInfo;

  /**
   * Gracefully closes connections and flushes/cleans up resources.
   */
  close(): Promise<void>;
}
