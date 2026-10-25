import { type FusionRepository } from './fusionRepository.js';
import { type InboxPublisher } from './inboxPublisher.js';
import { type Clock } from '../core/clock.js';
import { applySnoozeExpired } from './workflow.js';
import { logger } from '../core/logger.js';

export class SnoozeSweeper {
  private timer: NodeJS.Timeout | null = null;
  private isSweeping = false;

  constructor(
    private readonly repository: FusionRepository,
    private readonly publisher: InboxPublisher,
    private readonly clock: Clock,
    private readonly sweepIntervalSec: number = 5,
  ) {}

  /**
   * Sweeps once to wake all snoozed alerts whose snoozed_until timestamp has elapsed.
   * Exported and deterministic for unit and integration tests.
   */
  public async sweepOnce(currentDateOrIso?: Date | string): Promise<number> {
    const nowIso = currentDateOrIso
      ? typeof currentDateOrIso === 'string'
        ? currentDateOrIso
        : currentDateOrIso.toISOString()
      : this.clock.nowIso();

    const expiredAlerts = await this.repository.findExpiredSnoozes(nowIso);
    let awakenedCount = 0;

    for (const alert of expiredAlerts) {
      try {
        const { state } = applySnoozeExpired(alert.toObject(), nowIso);
        const updated = await this.repository.atomicUpdateAlert(
          alert._id.toString(),
          state,
          alert.version,
        );

        await this.publisher.publishInboxEvent(
          'inbox.status_changed',
          updated,
          undefined,
          'system',
        );
        awakenedCount += 1;
      } catch (err) {
        logger.error(
          { err, alertId: alert._id?.toString(), groupKey: alert.group_key },
          'Failed to wake expired snoozed alert',
        );
      }
    }

    return awakenedCount;
  }

  /**
   * Starts periodic background sweeping.
   */
  public start(): void {
    if (this.timer) return;

    this.timer = setInterval(async () => {
      if (this.isSweeping) return;
      this.isSweeping = true;
      try {
        await this.sweepOnce();
      } catch (err) {
        logger.error({ err }, 'Error during background snooze sweep');
      } finally {
        this.isSweeping = false;
      }
    }, this.sweepIntervalSec * 1000);

    // Unref so timer doesn't prevent Node process exit
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stops periodic background sweeping.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
