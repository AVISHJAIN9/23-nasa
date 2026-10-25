/**
 * Clock abstraction for time injection across AstroCare services.
 * Allows pure and deterministic testing of time-dependent workflows (snooze, suppression, timestamps).
 */
export interface Clock {
  /** Returns the current Date */
  now(): Date;
  /** Returns the current unix timestamp in milliseconds */
  nowMs(): number;
  /** Returns the current ISO 8601 UTC string */
  nowIso(): string;
}

/**
 * Real system clock delegating to standard JavaScript Date.
 */
export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }

  public nowMs(): number {
    return Date.now();
  }

  public nowIso(): string {
    return new Date().toISOString();
  }
}

/**
 * Fake clock for deterministic unit and integration testing.
 */
export class FakeClock implements Clock {
  private currentTime: Date;

  constructor(initialTime: Date | string | number = '2026-10-18T12:00:00.000Z') {
    this.currentTime = new Date(initialTime);
  }

  public now(): Date {
    return new Date(this.currentTime.getTime());
  }

  public nowMs(): number {
    return this.currentTime.getTime();
  }

  public nowIso(): string {
    return this.currentTime.toISOString();
  }

  public set(time: Date | string | number): void {
    this.currentTime = new Date(time);
  }

  public advanceMs(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }

  public advanceSeconds(s: number): void {
    this.advanceMs(s * 1000);
  }

  public advanceMinutes(m: number): void {
    this.advanceMs(m * 60 * 1000);
  }

  public advanceHours(h: number): void {
    this.advanceMs(h * 3600 * 1000);
  }
}
