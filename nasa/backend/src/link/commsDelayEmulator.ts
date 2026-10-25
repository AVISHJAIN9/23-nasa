/**
 * @module commsDelayEmulator
 * CommsDelayEmulator service — the central authority for current link state (Part 2e / F070).
 *
 * Responsibilities
 * ----------------
 * 1. Resolve the effective mission profile for the current mode.
 * 2. Load active overrides and scheduled blackouts from LinkStore.
 * 3. Merge stored blackouts with profile-computed blackout windows.
 * 4. Compute and cache the current LinkState.
 * 5. Provide subscribe/notify for link state changes (onChange callbacks).
 * 6. Expose a lightweight `delivery(wallMs, opts)` method for DelayStampingBus.
 */

import { type Clock } from '../core/clock.js';
import { type Settings } from '../core/config.js';
import { logger } from '../core/logger.js';
import { resolveProfile, type MissionModeKey } from '../mission/profileResolver.js';
import {
  computeDelivery,
  mergeWindows,
  resolveBlackoutWindows,
  type ComputeDeliveryOptions,
} from './linkModel.js';
import type { LinkStore } from './linkStore.js';
import type { LinkState, DeliveryDecision, ResolvedBlackoutWindow } from './linkTypes.js';
import { defaultMetricsRegistry } from '../core/metrics.js';

export type LinkStateChangeCallback = (prev: LinkState | null, next: LinkState) => void;

export interface CommsDelayEmulatorDeps {
  clock: Clock;
  settings: Settings;
  linkStore: LinkStore;
}

export class CommsDelayEmulator {
  private currentState: LinkState | null = null;
  private readonly callbacks: LinkStateChangeCallback[] = [];

  constructor(private readonly deps: CommsDelayEmulatorDeps) {}

  /**
   * Computes and caches the current link state.
   * Merges profile-computed blackouts with any active stored blackouts.
   * Applies active admin override on top.
   *
   * This is called by LinkWatcher on every tick, and can be called on demand.
   */
  public async refresh(): Promise<LinkState> {
    const wallMs = this.deps.clock.nowMs();
    const mode = this.deps.settings.mission_mode as MissionModeKey;
    const profile = resolveProfile(mode, this.deps.settings);

    // Load active admin override (null if none)
    const override = await this.deps.linkStore.getOverride('downlink');

    // Merge profile-computed blackouts + stored scheduled blackouts
    const profileWindows = resolveBlackoutWindows(profile.radio.blackouts, wallMs);
    const storedWindows: ResolvedBlackoutWindow[] = await this.deps.linkStore.getActiveBlackouts(
      wallMs,
      mode,
    );
    const mergedWindows = mergeWindows([...profileWindows, ...storedWindows]);

    // computeLinkState uses resolveBlackoutWindows internally — we need to bypass
    // that by using the pre-resolved windows. Compute state manually:
    const { effectiveOneWayDelayMs: computeDelay } = await import('./linkModel.js');

    // Compute delay from the profile radio link (which has the sinusoid parameters)
    const effectiveDelayMs = computeDelay(profile.radio, wallMs);

    // Check merged windows for blackout
    let inBlackout = false;
    let blackoutLabel: string | null = null;
    for (const w of mergedWindows) {
      if (w.startMs > wallMs) break;
      if (wallMs < w.endMs) {
        inBlackout = true;
        blackoutLabel = w.label;
        break;
      }
    }

    let overrideActive = false;
    let finalDelayMs = effectiveDelayMs;
    let packetLossRate = profile.radio.packetLossRate ?? 0;

    if (override) {
      const expired = override.expires_at !== undefined && wallMs > override.expires_at;
      if (!expired) {
        overrideActive = true;
        if (override.force_delay_ms !== undefined) finalDelayMs = override.force_delay_ms;
        if (override.force_blackout !== undefined) {
          inBlackout = override.force_blackout;
          if (!inBlackout) blackoutLabel = null;
          else if (blackoutLabel === null) blackoutLabel = 'admin-forced';
        }
        if (override.force_packet_loss_rate !== undefined) {
          packetLossRate = override.force_packet_loss_rate;
        }
      }
    }

    const next: LinkState = {
      effectiveDelayMs: finalDelayMs,
      inBlackout,
      blackoutLabel,
      packetLossRate,
      overrideActive,
      computedAt: wallMs,
    };

    const prev = this.currentState;
    this.currentState = next;

    defaultMetricsRegistry.setLinkState({
      missionMode: this.deps.settings?.mission_mode ?? 'iss',
      isBlackout: next.inBlackout,
      oneWayDelaySeconds: next.effectiveDelayMs / 1000,
      packetLossRate: next.packetLossRate,
    });

    // Notify subscribers if state changed meaningfully
    if (this.hasChanged(prev, next)) {
      this.notifyAll(prev, next);
    }

    return next;
  }

  /**
   * Returns the last computed LinkState (or calls refresh() if never computed).
   */
  public async getState(): Promise<LinkState> {
    if (!this.currentState) return this.refresh();
    return this.currentState;
  }

  /**
   * Synchronous state access for the stamping bus (uses cached value; may be stale by up to ASTRO_LINK_WATCH_S).
   * Returns null if never computed.
   */
  public getCachedState(): LinkState | null {
    return this.currentState;
  }

  /**
   * Computes a delivery decision for an event being published NOW.
   * Fails-open: if the cache is empty or stale, defaults to immediate delivery.
   */
  public delivery(wallMs: number, opts: ComputeDeliveryOptions = {}): DeliveryDecision {
    const state = this.currentState;
    if (!state) {
      // Fail-open: no state cached, deliver immediately
      return {
        deliverability: 'now',
        releaseAt: undefined,
        delayAppliedMs: 0,
        heldByBlackout: false,
        dropped: false,
        reason: 'ok',
      };
    }
    return computeDelivery(state, wallMs, opts);
  }

  /**
   * Register a callback invoked whenever the link state changes.
   * Returns an unsubscribe function.
   */
  public onChange(callback: LinkStateChangeCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx !== -1) this.callbacks.splice(idx, 1);
    };
  }

  /**
   * Apply an administrative override.
   * Calls refresh() and notifies subscribers after persisting.
   */
  public async setOverride(
    direction: 'uplink' | 'downlink',
    override: {
      force_delay_ms?: number;
      force_blackout?: boolean;
      force_packet_loss_rate?: number;
      actor_id: string;
      expires_at?: number;
    },
  ): Promise<LinkState> {
    await this.deps.linkStore.setOverride(direction, {
      direction,
      force_delay_ms: override.force_delay_ms,
      force_blackout: override.force_blackout,
      force_packet_loss_rate: override.force_packet_loss_rate,
      actor_id: override.actor_id,
      expires_at: override.expires_at,
    });
    return this.refresh();
  }

  /**
   * Remove an administrative override.
   */
  public async clearOverride(direction: 'uplink' | 'downlink'): Promise<LinkState> {
    await this.deps.linkStore.clearOverride(direction);
    return this.refresh();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private hasChanged(prev: LinkState | null, next: LinkState): boolean {
    if (!prev) return true;
    return (
      prev.inBlackout !== next.inBlackout ||
      prev.blackoutLabel !== next.blackoutLabel ||
      Math.abs(prev.effectiveDelayMs - next.effectiveDelayMs) > 1000 || // >1s change
      prev.packetLossRate !== next.packetLossRate ||
      prev.overrideActive !== next.overrideActive
    );
  }

  private notifyAll(prev: LinkState | null, next: LinkState): void {
    for (const cb of this.callbacks) {
      try {
        cb(prev, next);
      } catch (err) {
        logger.warn({ err }, '[CommsDelayEmulator] onChange callback threw');
      }
    }
  }
}
