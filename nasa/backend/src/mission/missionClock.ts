import { type Clock } from '../core/clock.js';
import { type Settings } from '../core/config.js';
import { type EventBus } from '../bus/eventBus.js';
import { type AuditWriter } from '../core/audit.js';
import { MissionClock, type IMissionClock } from '../models/MissionClock.js';
import { ValidationError } from '../core/errors.js';
import { logger } from '../core/logger.js';

export interface MissionClockState {
  mission_start_at: number; // epoch ms
  anchor_wall_at: number; // epoch ms
  anchor_mission_at: number; // epoch ms
  time_scale: number;
  updated_by: string;
  updated_at: number;
  version: number;
}

export interface ClockStatusDTO {
  mission_now: string;
  mission_day: number;
  mission_start_at: string;
  time_scale: number;
  wall_now: string;
  mission_mode: string;
}

/**
 * Pure function: calculates the current mission epoch ms given anchor state and current wall clock ms.
 */
export function missionNowMs(state: MissionClockState, wallMs: number): number {
  return state.anchor_mission_at + (wallMs - state.anchor_wall_at) * state.time_scale;
}

/**
 * Pure function: calculates the 1-indexed mission day number for a given mission timestamp ms.
 * Day 1 is [mission_start_at, mission_start_at + 86400000ms).
 */
export function missionDay(
  state: Pick<MissionClockState, 'mission_start_at'>,
  missionMs: number,
): number {
  return Math.floor((missionMs - state.mission_start_at) / 86400000) + 1;
}

/**
 * Pure function: calculates the future wall clock epoch ms at which a mission timestamp ms will occur,
 * using the CURRENT time scale.
 * Note: valid for future projections under the current scale.
 */
export function wallAtMissionMs(state: MissionClockState, missionMs: number): number {
  return state.anchor_wall_at + (missionMs - state.anchor_mission_at) / state.time_scale;
}

export interface MissionClockDeps {
  clock: Clock;
  settings: Settings;
  eventBus: EventBus;
  auditWriter: AuditWriter;
  getMissionMode?: () => string;
}

export class MissionClockService {
  private cachedState: MissionClockState | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: MissionClockDeps) {}

  /**
   * Initializes or loads the mission clock singleton from MongoDB.
   * On first boot (no document exists):
   * - mission_start_at = ASTRO_MISSION_START_AT if set, else now minus (ASTRO_MISSION_INITIAL_DAY - 1) days
   * - anchor_wall_at = anchor_mission_at = now
   * - time_scale = ASTRO_MISSION_TIME_SCALE
   */
  public async init(): Promise<void> {
    let doc = await MissionClock.findOne();
    const nowWall = this.deps.clock.nowMs();

    if (!doc) {
      let startMs: number;
      if (this.deps.settings.mission_start_at) {
        startMs = new Date(this.deps.settings.mission_start_at).getTime();
      } else {
        const initialDay = this.deps.settings.mission_initial_day ?? 31;
        startMs = nowWall - (initialDay - 1) * 86400000;
      }

      const initialScale = this.deps.settings.mission_time_scale ?? 1;

      try {
        doc = await MissionClock.create({
          mission_start_at: new Date(startMs),
          anchor_wall_at: new Date(nowWall),
          anchor_mission_at: new Date(nowWall),
          time_scale: initialScale,
          updated_by: 'system',
          updated_at: new Date(nowWall),
          version: 1,
        });
      } catch (err) {
        // In case of race condition during concurrent boot
        doc = await MissionClock.findOne();
        if (!doc) throw err;
      }
    }

    this.updateCache(doc);
    this.startPeriodicRefresh();
  }

  private updateCache(doc: IMissionClock): void {
    this.cachedState = {
      mission_start_at: doc.mission_start_at.getTime(),
      anchor_wall_at: doc.anchor_wall_at.getTime(),
      anchor_mission_at: doc.anchor_mission_at.getTime(),
      time_scale: doc.time_scale,
      updated_by: doc.updated_by,
      updated_at: doc.updated_at.getTime(),
      version: doc.version,
    };
  }

  public async reload(): Promise<void> {
    const doc = await MissionClock.findOne();
    if (doc) {
      this.updateCache(doc);
    }
  }

  private startPeriodicRefresh(): void {
    if (this.refreshTimer) return;
    const intervalMs = (this.deps.settings.clock_refresh_s ?? 15) * 1000;
    this.refreshTimer = setInterval(() => {
      this.reload().catch((err) => {
        logger.warn({ err }, 'Failed periodic reload of mission clock from Mongo');
      });
    }, intervalMs);
    // Don't keep Node process open in test runners
    if (this.refreshTimer.unref) {
      this.refreshTimer.unref();
    }
  }

  public stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private getState(): MissionClockState {
    if (!this.cachedState) {
      const nowWall = this.deps.clock.nowMs();
      const initialDay = this.deps.settings.mission_initial_day ?? 31;
      const startMs = nowWall - (initialDay - 1) * 86400000;
      return {
        mission_start_at: startMs,
        anchor_wall_at: nowWall,
        anchor_mission_at: nowWall,
        time_scale: this.deps.settings.mission_time_scale ?? 1,
        updated_by: 'fallback',
        updated_at: nowWall,
        version: 1,
      };
    }
    return this.cachedState;
  }

  public nowMs(): number {
    return missionNowMs(this.getState(), this.deps.clock.nowMs());
  }

  public now(): Date {
    return new Date(this.nowMs());
  }

  public nowIso(): string {
    return this.now().toISOString();
  }

  public day(): number {
    const state = this.getState();
    return missionDay(state, this.nowMs());
  }

  public rawState(): MissionClockState {
    return this.getState();
  }

  public getStatus(): ClockStatusDTO {
    const state = this.getState();
    const nowMission = this.nowMs();
    const mode = this.deps.getMissionMode
      ? this.deps.getMissionMode()
      : this.deps.settings.mission_mode;

    return {
      mission_now: new Date(nowMission).toISOString(),
      mission_day: missionDay(state, nowMission),
      mission_start_at: new Date(state.mission_start_at).toISOString(),
      time_scale: state.time_scale,
      wall_now: new Date(this.deps.clock.now()).toISOString(),
      mission_mode: mode,
    };
  }

  /**
   * Sets a new mission time scale, re-anchoring at the current wall time so mission time stays continuous.
   * Allowed scale range: 0.1 to 3600.
   */
  public async setTimeScale(
    scale: number,
    actor: string,
    requestId?: string,
  ): Promise<ClockStatusDTO> {
    if (typeof scale !== 'number' || Number.isNaN(scale) || scale < 0.1 || scale > 3600) {
      throw new ValidationError('Invalid time_scale: must be a number between 0.1 and 3600', [
        { field: 'time_scale', issue: 'Scale must be between 0.1 and 3600' },
      ]);
    }

    const state = this.getState();
    const nowWall = this.deps.clock.nowMs();
    const currentMissionNow = missionNowMs(state, nowWall);

    const doc = await MissionClock.findOneAndUpdate(
      {},
      {
        $set: {
          anchor_wall_at: new Date(nowWall),
          anchor_mission_at: new Date(currentMissionNow),
          time_scale: scale,
          updated_by: actor,
          updated_at: new Date(nowWall),
        },
        $setOnInsert: {
          // If this is a first-time upsert (no init() was called), seed required fields
          mission_start_at: new Date(state.mission_start_at),
        },
        $inc: { version: 1 },
      },
      { new: true, upsert: true },
    );

    if (!doc) {
      throw new Error('Mission clock document unexpectedly missing after upsert');
    }

    this.updateCache(doc);

    await this.deps.auditWriter.write({
      actor_id: actor,
      action: 'MISSION_CLOCK_SCALE_CHANGED',
      target_id: 'mission_clock',
      request_id: requestId,
      metadata: {
        previous_scale: state.time_scale,
        new_scale: scale,
        reanchor_wall_at: new Date(nowWall).toISOString(),
        reanchor_mission_at: new Date(currentMissionNow).toISOString(),
      },
    });

    const status = this.getStatus();

    await this.deps.eventBus.publish({
      topic: 'system',
      type: 'system.notice',
      severity: 'info',
      audience: 'all',
      origin: 'system',
      request_id: requestId,
      payload: {
        kind: 'mission.clock_changed',
        time_scale: scale,
        mission_now: status.mission_now,
        mission_day: status.mission_day,
      },
    });

    return status;
  }
}
