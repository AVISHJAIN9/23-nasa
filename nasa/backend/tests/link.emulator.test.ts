/**
 * Tests for CommsDelayEmulator and LinkWatcher (Part 2e / F070).
 * Uses in-memory LinkStore and FakeClock — no MongoDB required.
 */
import { describe, it, expect } from 'vitest';
import { FakeClock } from '../src/core/clock.js';
import { MemoryEventBus } from '../src/bus/memoryEventBus.js';
import { parseConfig } from '../src/core/config.js';
import { CommsDelayEmulator } from '../src/link/commsDelayEmulator.js';
import { LinkWatcher } from '../src/link/linkWatcher.js';
import { InMemoryLinkStore } from '../src/link/linkStore.js';
import type { LinkState } from '../src/link/linkTypes.js';
import type { Envelope } from '../src/bus/eventTypes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmulator(wallMs: number, mode: 'iss' | 'moon' | 'mars' = 'mars') {
  const clock = new FakeClock(wallMs);
  const settings = parseConfig({ ASTRO_MISSION_MODE: mode });
  const linkStore = new InMemoryLinkStore();

  const emulator = new CommsDelayEmulator({ clock, settings, linkStore });
  return { clock, settings, linkStore, emulator };
}

// ---------------------------------------------------------------------------
// CommsDelayEmulator
// ---------------------------------------------------------------------------

describe('CommsDelayEmulator', () => {
  it('refresh() returns a LinkState with numeric delay and boolean inBlackout', async () => {
    const { emulator } = makeEmulator(Date.UTC(2024, 5, 15, 10, 0, 0), 'moon');
    const state = await emulator.refresh();

    expect(typeof state.effectiveDelayMs).toBe('number');
    expect(state.effectiveDelayMs).toBeGreaterThan(0);
    expect(typeof state.inBlackout).toBe('boolean');
    expect(typeof state.computedAt).toBe('number');
  });

  it('getCachedState() returns null before first refresh, then the cached state', async () => {
    const { emulator } = makeEmulator(Date.UTC(2024, 0, 1, 6, 0, 0));
    expect(emulator.getCachedState()).toBeNull();

    await emulator.refresh();
    expect(emulator.getCachedState()).not.toBeNull();
  });

  it('delivery() fails-open and returns "now" when no state is cached', () => {
    const { emulator } = makeEmulator(Date.UTC(2024, 0, 1, 6, 0, 0));
    const decision = emulator.delivery(Date.UTC(2024, 0, 1, 6, 0, 0));
    expect(decision.deliverability).toBe('now');
  });

  it('setOverride() forces delay and is reflected in refresh()', async () => {
    const wallMs = Date.UTC(2024, 0, 1, 12, 0, 0);
    const { emulator } = makeEmulator(wallMs, 'mars');

    const state = await emulator.setOverride('downlink', {
      force_delay_ms: 500,
      actor_id: 'admin',
    });

    expect(state.effectiveDelayMs).toBe(500);
    expect(state.overrideActive).toBe(true);
  });

  it('clearOverride() removes the override and restores computed delay', async () => {
    const wallMs = Date.UTC(2024, 0, 1, 12, 0, 0);
    const { emulator } = makeEmulator(wallMs, 'iss');

    await emulator.setOverride('downlink', { force_delay_ms: 999, actor_id: 'admin' });
    let state = await emulator.getCachedState()!;
    expect(state.effectiveDelayMs).toBe(999);

    state = await emulator.clearOverride('downlink');
    expect(state.effectiveDelayMs).not.toBe(999);
    expect(state.overrideActive).toBe(false);
  });

  it('onChange callback is invoked when state changes meaningfully', async () => {
    const wallMs = Date.UTC(2024, 0, 1, 12, 0, 0);
    const { emulator } = makeEmulator(wallMs, 'iss');

    const changes: LinkState[] = [];
    emulator.onChange((_prev, next) => changes.push(next));

    // First refresh triggers "initial" change (prev=null)
    await emulator.refresh();
    expect(changes).toHaveLength(1);

    // Second refresh with same state should NOT trigger
    await emulator.refresh();
    expect(changes).toHaveLength(1);
  });

  it('onChange unsubscribe stops further notifications', async () => {
    const wallMs = Date.UTC(2024, 0, 1, 12, 0, 0);
    const { emulator } = makeEmulator(wallMs, 'moon');

    const calls: number[] = [];
    const unsub = emulator.onChange(() => calls.push(1));

    await emulator.refresh(); // triggers once
    unsub();
    await emulator.setOverride('downlink', { force_delay_ms: 1, actor_id: 'test' }); // would trigger again
    expect(calls).toHaveLength(1);
  });

  it('delivery() returns "later" after refresh with Mars significant delay', async () => {
    // Mars minimum delay is 3 minutes — well above 100ms threshold
    const wallMs = Date.UTC(2024, 0, 1, 12, 0, 0);
    const { emulator } = makeEmulator(wallMs, 'mars');

    // Ensure not in blackout by setting no-blackout override
    await emulator.setOverride('downlink', { force_blackout: false, actor_id: 'test' });
    const decision = emulator.delivery(wallMs);
    expect(decision.deliverability).toBe('later');
    expect(decision.heldByBlackout).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LinkWatcher
// ---------------------------------------------------------------------------

describe('LinkWatcher', () => {
  it('tick() refreshes state and returns LinkState', async () => {
    const wallMs = Date.UTC(2024, 3, 10, 6, 0, 0);
    const { emulator, clock, settings } = makeEmulator(wallMs, 'moon');
    const eventBus = new MemoryEventBus();

    const watcher = new LinkWatcher({ emulator, eventBus, clock, settings });
    const state = await watcher.tick();

    expect(state).toBeDefined();
    expect(typeof state.effectiveDelayMs).toBe('number');
  });

  it('tick() publishes system.notice on state change', async () => {
    const wallMs = Date.UTC(2024, 3, 10, 6, 0, 0);
    const { emulator, clock, settings } = makeEmulator(wallMs, 'iss');
    const eventBus = new MemoryEventBus();

    const published: Envelope[] = [];
    eventBus.subscribe((env) => published.push(env), { topics: ['system'] });

    const watcher = new LinkWatcher({ emulator, eventBus, clock, settings });

    // First tick: prev=null, always triggers publish
    await watcher.tick();
    expect(published.length).toBeGreaterThanOrEqual(1);
    expect(published[0]!.type).toBe('system.notice');
    expect((published[0]!.payload as Record<string, unknown>)['kind']).toMatch(/^link\./);
  });

  it('tick() does NOT publish when state is unchanged', async () => {
    const wallMs = Date.UTC(2024, 0, 1, 14, 0, 0); // between ISS blackouts
    const { emulator, clock, settings } = makeEmulator(wallMs, 'iss');
    const eventBus = new MemoryEventBus();

    const published: Envelope[] = [];
    eventBus.subscribe((env) => published.push(env), { topics: ['system'] });

    const watcher = new LinkWatcher({ emulator, eventBus, clock, settings });

    await watcher.tick(); // first tick – publishes
    const countAfterFirst = published.length;

    await watcher.tick(); // second tick – same state, should not publish again
    expect(published.length).toBe(countAfterFirst);
  });

  it('start() / stop() manage the internal timer without errors', () => {
    const wallMs = Date.UTC(2024, 0, 1, 12, 0, 0);
    const { emulator, clock, settings } = makeEmulator(wallMs, 'mars');
    const eventBus = new MemoryEventBus();

    const watcher = new LinkWatcher({ emulator, eventBus, clock, settings });
    watcher.start();
    watcher.start(); // idempotent
    watcher.stop();
    watcher.stop(); // idempotent
  });
});
