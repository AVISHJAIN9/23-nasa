/**
 * @module linkTypes
 * Shared types and interfaces for the Communications Delay Emulator (F070).
 *
 * All types are pure data — no I/O or side-effects.
 */

export type LinkDirection = 'uplink' | 'downlink';

/** Computed state of the communication link at a point in time. */
/** Computed state of the communication link at a point in time. */
export interface LinkState {
  /** Effective one-way delay in milliseconds at this moment. */
  effectiveDelayMs: number;
  /** Whether the link is currently in a blackout window. */
  inBlackout: boolean;
  /** Name of the active blackout window if inBlackout is true. */
  blackoutLabel: string | null;
  /** Effective packet loss probability (0.0 to 1.0). */
  packetLossRate: number;
  /** Whether the link has been administratively overridden. */
  overrideActive: boolean;
  /** Timestamp (epoch ms) at which this state was computed. */
  computedAt: number;
}

/** Delivery decision for a single event payload. */
export interface DeliveryDecision {
  /** 'now' = can be delivered immediately; 'later' = must be delayed; 'never' = dropped. */
  deliverability: 'now' | 'later' | 'never';
  /**
   * Wall-clock epoch ms at which to release the message.
   * Undefined when deliverability is 'now' or 'never'.
   */
  releaseAt: number | undefined;
  /** Total one-way delay applied (ms). Zero when deliverability is 'never'. */
  delayAppliedMs: number;
  /** True when held exclusively because of a blackout. */
  heldByBlackout: boolean;
  /** True when dropped (blackout + drop policy, packet loss, or bandwidth exceeded). */
  dropped: boolean;
  /**
   * Reason string for observability / logging.
   * Format: 'ok' | 'delayed:<ms>' | 'blackout_held' | 'blackout_dropped' | 'packet_loss' | 'throttled'
   */
  reason: string;
}

/** Stamped metadata appended to every Envelope processed by DelayStampingBus. */
export interface DeliveryMeta {
  /** Target audience direction. */
  target: LinkDirection;
  /** Effective one-way delay applied (ms). */
  delay_ms: number;
  /** ISO wall timestamp when this message will be released. */
  release_at: string;
  /** True if this message is currently held due to a comms blackout. */
  held_by_blackout: boolean;
  /** True if this message was dropped and will not be delivered. */
  dropped: boolean;
}

/** Persisted override record stored in LinkOverride collection. */
export interface LinkOverrideRecord {
  /** ISO timestamp of override creation. */
  created_at: string;
  /** Which direction this override applies to. */
  direction: LinkDirection;
  /** Forced one-way delay in ms (undefined = no force, use computed delay). */
  force_delay_ms: number | undefined;
  /** Force blackout state on (true), off (false), or undefined = let model decide. */
  force_blackout: boolean | undefined;
  /** Force packet loss rate (0.0 to 1.0, undefined = use profile baseline). */
  force_packet_loss_rate?: number | undefined;
  /** Who created this override. */
  actor_id: string;
  /** When this override expires (epoch ms), undefined = manual removal only. */
  expires_at: number | undefined;
}

/** A resolved blackout window with wall-clock start/end epoch ms. */
export interface ResolvedBlackoutWindow {
  label: string;
  startMs: number;
  endMs: number;
}
