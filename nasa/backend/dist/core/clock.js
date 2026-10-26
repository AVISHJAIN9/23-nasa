/**
 * Real system clock delegating to standard JavaScript Date.
 */
export class SystemClock {
    now() {
        return new Date();
    }
    nowMs() {
        return Date.now();
    }
    nowIso() {
        return new Date().toISOString();
    }
}
/**
 * Fake clock for deterministic unit and integration testing.
 */
export class FakeClock {
    currentTime;
    constructor(initialTime = '2026-10-18T12:00:00.000Z') {
        this.currentTime = new Date(initialTime);
    }
    now() {
        return new Date(this.currentTime.getTime());
    }
    nowMs() {
        return this.currentTime.getTime();
    }
    nowIso() {
        return this.currentTime.toISOString();
    }
    set(time) {
        this.currentTime = new Date(time);
    }
    advanceMs(ms) {
        this.currentTime = new Date(this.currentTime.getTime() + ms);
    }
    advanceSeconds(s) {
        this.advanceMs(s * 1000);
    }
    advanceMinutes(m) {
        this.advanceMs(m * 60 * 1000);
    }
    advanceHours(h) {
        this.advanceMs(h * 3600 * 1000);
    }
}
