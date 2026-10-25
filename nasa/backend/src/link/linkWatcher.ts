/**
 * @module linkWatcher
 * Periodic link state evaluator (Part 2e / F070).
 *
 * Runs every ASTRO_LINK_WATCH_S seconds (default 30), calls
 * CommsDelayEmulator.refresh(), and publishes a `link.state_changed`
 * system.notice event to the EventBus whenever the link state changes meaningfully.
 *
 * Also persists a LinkEvent record on each meaningful state change for the
 * /v1/link/events audit trail.
 */

import { type Clock } from '../core/clock.js';
import { type EventBus } from '../bus/eventBus.js';
import { type Settings } from '../core/config.js';
import { logger } from '../core/logger.js';
import { LinkEvent } from '../models/LinkEvent.js';
import { type CommsDelayEmulator } from './commsDelayEmulator.js';
import type { LinkState } from './linkTypes.js';

export interface LinkWatcherDeps {
  emulator: CommsDelayEmulator;
  eventBus: EventBus;
  clock: Clock;
  settings: Settings;
}

export class LinkWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastState: LinkState | null = null;

  constructor(private readonly deps: LinkWatcherDeps) {}

  /** Start the periodic watcher. Idempotent. */
  public start(): void {
    if (this.timer) return;
    const intervalMs = (this.deps.settings.link_watch_s ?? 30) * 1000;

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.warn({ err }, '[LinkWatcher] tick error');
      });
    }, intervalMs);

    if (this.timer.unref) this.timer.unref();

    logger.debug({ intervalMs }, '[LinkWatcher] started');
  }

  /** Stop the periodic watcher. */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Execute one evaluation tick. Can be called manually in tests. */
  public async tick(): Promise<LinkState> {
    const next = await this.deps.emulator.refresh();
    const prev = this.lastState;

    if (this.hasChanged(prev, next)) {
      await this.persist(next);
      await this.publish(prev, next);
    }

    this.lastState = next;
    return next;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private hasChanged(prev: LinkState | null, next: LinkState): boolean {
    if (!prev) return true;
    return (
      prev.inBlackout !== next.inBlackout ||
      prev.blackoutLabel !== next.blackoutLabel ||
      Math.abs(prev.effectiveDelayMs - next.effectiveDelayMs) > 1000 ||
      prev.overrideActive !== next.overrideActive
    );
  }

  private async persist(state: LinkState): Promise<void> {
    try {
      const mode = this.deps.settings.mission_mode as 'iss' | 'moon' | 'mars';
      await LinkEvent.create({
        kind: state.inBlackout ? 'blackout_started' : 'state_evaluated',
        mission_mode: mode,
        delay_ms: state.effectiveDelayMs,
        in_blackout: state.inBlackout,
        blackout_label: state.blackoutLabel,
        override_active: state.overrideActive,
        occurred_at: new Date(state.computedAt),
      });
    } catch (err) {
      logger.warn({ err }, '[LinkWatcher] failed to persist link event');
    }
  }

  private async publish(prev: LinkState | null, next: LinkState): Promise<void> {
    try {
      const kind = (() => {
        if (!prev) return 'link.initial';
        if (!prev.inBlackout && next.inBlackout) return 'link.blackout_started';
        if (prev.inBlackout && !next.inBlackout) return 'link.blackout_ended';
        if (next.overrideActive && !prev.overrideActive) return 'link.override_applied';
        if (!next.overrideActive && prev.overrideActive) return 'link.override_removed';
        return 'link.state_changed';
      })();

      await this.deps.eventBus.publish({
        topic: 'system',
        type: 'system.notice',
        severity: next.inBlackout ? 'warning' : 'info',
        audience: 'all',
        origin: 'system',
        payload: {
          kind,
          delay_ms: next.effectiveDelayMs,
          in_blackout: next.inBlackout,
          blackout_label: next.blackoutLabel,
          override_active: next.overrideActive,
        },
      });
    } catch (err) {
      logger.warn({ err }, '[LinkWatcher] failed to publish link state change');
    }
  }
}
