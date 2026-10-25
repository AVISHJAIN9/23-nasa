/**
 * Tests for pure link model functions (Part 2e / F070).
 * No MongoDB, no network, no wall-clock — all deterministic.
 */
import { describe, it, expect } from 'vitest';
import {
  effectiveOneWayDelayMs,
  resolveBlackoutWindows,
  mergeWindows,
  findActiveBlackout,
  computeLinkState,
  computeDelivery,
} from '../src/link/linkModel.js';
import type { RadioLink } from '../src/mission/missionProfiles.js';
import { MARS_PROFILE, ISS_PROFILE, MOON_PROFILE } from '../src/mission/missionProfiles.js';

// ---------------------------------------------------------------------------
// effectiveOneWayDelayMs
// ---------------------------------------------------------------------------

describe('effectiveOneWayDelayMs', () => {
  const CONST_LINK: RadioLink = {
    delay: { minMs: 1200, maxMs: 1360 },
    sinusoidalDelay: false,
    sinusoidPeriodS: 86400,
    blackouts: [],
    downlinkThrottleBps: 0,
  };

  it('returns minMs for constant (non-sinusoidal) links regardless of wallMs', () => {
    expect(effectiveOneWayDelayMs(CONST_LINK, 0)).toBe(1200);
    expect(effectiveOneWayDelayMs(CONST_LINK, 999999999)).toBe(1200);
  });

  it('returns midpoint at sin=0 phase for sinusoidal Mars link', () => {
    // sin(0) = 0, so delay = midpoint = (3min + 22min) / 2 * 60000
    const marsLink = MARS_PROFILE.radio;
    const midpoint = (marsLink.delay.minMs + marsLink.delay.maxMs) / 2;
    // wallMs = 0 → sin(0) = 0 → delay = midpoint
    const result = effectiveOneWayDelayMs(marsLink, 0);
    expect(result).toBe(Math.round(midpoint));
  });

  it('returns maxMs at sin=1 phase (wallMs = period/4) for Mars link', () => {
    const marsLink = MARS_PROFILE.radio;
    const periodMs = marsLink.sinusoidPeriodS * 1000;
    // At wallMs = period/4, sin(2π * (period/4) / period) = sin(π/2) = 1
    const wallMs = periodMs / 4;
    const result = effectiveOneWayDelayMs(marsLink, wallMs);
    expect(result).toBe(marsLink.delay.maxMs);
  });

  it('returns minMs at sin=-1 phase (wallMs = 3*period/4) for Mars link', () => {
    const marsLink = MARS_PROFILE.radio;
    const periodMs = marsLink.sinusoidPeriodS * 1000;
    const wallMs = (3 * periodMs) / 4;
    const result = effectiveOneWayDelayMs(marsLink, wallMs);
    expect(result).toBe(marsLink.delay.minMs);
  });

  it('delay always stays within [minMs, maxMs] across full period', () => {
    const marsLink = MARS_PROFILE.radio;
    const periodMs = marsLink.sinusoidPeriodS * 1000;
    const steps = 100;
    for (let i = 0; i < steps; i++) {
      const wallMs = (i * periodMs) / steps;
      const delay = effectiveOneWayDelayMs(marsLink, wallMs);
      expect(delay).toBeGreaterThanOrEqual(marsLink.delay.minMs);
      expect(delay).toBeLessThanOrEqual(marsLink.delay.maxMs);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveBlackoutWindows & mergeWindows
// ---------------------------------------------------------------------------

describe('resolveBlackoutWindows', () => {
  const MS_PER_DAY = 86_400_000;

  it('maps fraction 0.0 → day midnight and 0.5 → noon UTC', () => {
    // Ref at noon UTC on 2024-01-01 = 1704110400000
    const noonMs = 1704110400000;
    const dayStart = noonMs - (noonMs % MS_PER_DAY);

    const windows = resolveBlackoutWindows(
      [{ label: 'test', startFraction: 0.0, endFraction: 0.5 }],
      noonMs,
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]!.startMs).toBe(dayStart);
    expect(windows[0]!.endMs).toBe(dayStart + MS_PER_DAY / 2);
  });

  it('returns windows sorted by startMs', () => {
    const refMs = Date.UTC(2024, 5, 15, 12, 0, 0);
    const windows = resolveBlackoutWindows(
      [
        { label: 'B', startFraction: 0.6, endFraction: 0.7 },
        { label: 'A', startFraction: 0.1, endFraction: 0.2 },
      ],
      refMs,
    );
    expect(windows[0]!.label).toBe('A');
    expect(windows[1]!.label).toBe('B');
  });

  it('handles ISS profile 4 blackouts correctly (no overlap)', () => {
    const refMs = Date.UTC(2024, 0, 1, 6, 0, 0);
    const windows = resolveBlackoutWindows(ISS_PROFILE.radio.blackouts, refMs);
    expect(windows).toHaveLength(4);
    // Verify no overlap: each window ends before the next starts
    for (let i = 0; i < windows.length - 1; i++) {
      expect(windows[i]!.endMs).toBeLessThanOrEqual(windows[i + 1]!.startMs);
    }
  });
});

describe('mergeWindows', () => {
  it('returns empty array for empty input', () => {
    expect(mergeWindows([])).toEqual([]);
  });

  it('returns single window unchanged', () => {
    const w = [{ label: 'X', startMs: 1000, endMs: 2000 }];
    expect(mergeWindows(w)).toEqual(w);
  });

  it('merges two overlapping windows', () => {
    const result = mergeWindows([
      { label: 'A', startMs: 1000, endMs: 3000 },
      { label: 'B', startMs: 2000, endMs: 4000 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.startMs).toBe(1000);
    expect(result[0]!.endMs).toBe(4000);
  });

  it('keeps two non-overlapping windows separate', () => {
    const result = mergeWindows([
      { label: 'A', startMs: 1000, endMs: 2000 },
      { label: 'B', startMs: 3000, endMs: 4000 },
    ]);
    expect(result).toHaveLength(2);
  });

  it('merges three windows: 1+2 merge, 3 stays separate', () => {
    const result = mergeWindows([
      { label: 'A', startMs: 0, endMs: 1500 },
      { label: 'B', startMs: 1000, endMs: 2000 },
      { label: 'C', startMs: 5000, endMs: 6000 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!.endMs).toBe(2000);
    expect(result[1]!.startMs).toBe(5000);
  });
});

describe('findActiveBlackout', () => {
  const windows = [
    { label: 'W1', startMs: 1000, endMs: 2000 },
    { label: 'W2', startMs: 5000, endMs: 6000 },
  ];

  it('returns null when before any window', () => {
    expect(findActiveBlackout(windows, 500)).toBeNull();
  });

  it('returns null between windows', () => {
    expect(findActiveBlackout(windows, 3000)).toBeNull();
  });

  it('returns null at exact endMs (windows are half-open [start, end))', () => {
    expect(findActiveBlackout(windows, 2000)).toBeNull();
  });

  it('returns window when wallMs is inside it', () => {
    const match = findActiveBlackout(windows, 1500);
    expect(match).not.toBeNull();
    expect(match!.label).toBe('W1');
  });

  it('returns window at exact startMs', () => {
    const match = findActiveBlackout(windows, 1000);
    expect(match!.label).toBe('W1');
  });

  it('returns second window correctly', () => {
    const match = findActiveBlackout(windows, 5500);
    expect(match!.label).toBe('W2');
  });
});

// ---------------------------------------------------------------------------
// computeLinkState
// ---------------------------------------------------------------------------

describe('computeLinkState', () => {
  const issLink = ISS_PROFILE.radio;

  it('reflects inBlackout=true when inside a blackout window', () => {
    // ISS first blackout: fraction 0.04–0.14 of a day
    const MS_PER_DAY = 86_400_000;
    const dayStart = Date.UTC(2024, 0, 1, 0, 0, 0);
    // Pick wall time at 0.09 fraction (middle of first window)
    const wallMs = dayStart + Math.floor(0.09 * MS_PER_DAY);
    const state = computeLinkState(issLink, wallMs);

    expect(state.inBlackout).toBe(true);
    expect(state.blackoutLabel).not.toBeNull();
  });

  it('reflects inBlackout=false when between blackout windows', () => {
    // Pick 0.25 fraction (between ISS blackout 1 ending at 0.14 and blackout 2 starting at 0.29)
    const MS_PER_DAY = 86_400_000;
    const dayStart = Date.UTC(2024, 0, 1, 0, 0, 0);
    const wallMs = dayStart + Math.floor(0.22 * MS_PER_DAY);
    const state = computeLinkState(issLink, wallMs);

    expect(state.inBlackout).toBe(false);
    expect(state.blackoutLabel).toBeNull();
  });

  it('admin override sets delay and blackout regardless of computed values', () => {
    const dayStart = Date.UTC(2024, 0, 1, 0, 0, 0);
    // Normally in blackout (fraction 0.09)
    const wallMs = dayStart + Math.floor(0.09 * 86_400_000);

    const override = {
      created_at: new Date(wallMs - 1000).toISOString(),
      direction: 'uplink' as const,
      force_delay_ms: 50,
      force_blackout: false,
      actor_id: 'admin',
      expires_at: wallMs + 60_000,
    };

    const state = computeLinkState(issLink, wallMs, override);
    expect(state.overrideActive).toBe(true);
    expect(state.effectiveDelayMs).toBe(50);
    expect(state.inBlackout).toBe(false);
  });

  it('ignores expired overrides', () => {
    const wallMs = Date.UTC(2024, 0, 1, 12, 0, 0);
    const override = {
      created_at: new Date(wallMs - 10_000).toISOString(),
      direction: 'downlink' as const,
      force_delay_ms: 99,
      force_blackout: true,
      actor_id: 'admin',
      expires_at: wallMs - 1, // Already expired
    };

    const state = computeLinkState(ISS_PROFILE.radio, wallMs, override);
    expect(state.overrideActive).toBe(false);
    expect(state.effectiveDelayMs).not.toBe(99);
  });
});

// ---------------------------------------------------------------------------
// computeDelivery
// ---------------------------------------------------------------------------

describe('computeDelivery', () => {
  it('returns "now" for negligible delay (≤100ms)', () => {
    const state = {
      effectiveDelayMs: 50,
      inBlackout: false,
      blackoutLabel: null,
      overrideActive: false,
      computedAt: 1000000,
    };
    const decision = computeDelivery(state, 1000000);
    expect(decision.deliverability).toBe('now');
    expect(decision.releaseAt).toBeUndefined();
    expect(decision.dropped).toBe(false);
  });

  it('returns "later" for significant delay with releaseAt = wallMs + delay', () => {
    const wallMs = 1_000_000_000;
    const state = {
      effectiveDelayMs: 3 * 60_000, // 3 min Mars minimum
      inBlackout: false,
      blackoutLabel: null,
      overrideActive: false,
      computedAt: wallMs,
    };
    const decision = computeDelivery(state, wallMs);
    expect(decision.deliverability).toBe('later');
    expect(decision.releaseAt).toBe(wallMs + 3 * 60_000);
    expect(decision.heldByBlackout).toBe(false);
    expect(decision.reason).toMatch(/^delayed:/);
  });

  it('returns "later" held_by_blackout when in blackout with hold policy', () => {
    const wallMs = 1_000_000_000;
    const blackoutEndMs = wallMs + 10_000;
    const state = {
      effectiveDelayMs: 1280,
      inBlackout: true,
      blackoutLabel: 'Farside-Blackout',
      overrideActive: false,
      computedAt: wallMs,
    };
    const decision = computeDelivery(state, wallMs, {
      blackoutPolicy: 'hold',
      isEphemeral: false,
      blackoutEndMs,
    });
    expect(decision.deliverability).toBe('later');
    expect(decision.heldByBlackout).toBe(true);
    expect(decision.releaseAt).toBe(blackoutEndMs + 1280);
    expect(decision.dropped).toBe(false);
    expect(decision.reason).toBe('blackout_held');
  });

  it('returns "never" dropped for ephemeral events during blackout with drop policy', () => {
    const wallMs = 1_000_000_000;
    const state = {
      effectiveDelayMs: 1280,
      inBlackout: true,
      blackoutLabel: 'Farside-Blackout',
      overrideActive: false,
      computedAt: wallMs,
    };
    const decision = computeDelivery(state, wallMs, {
      blackoutPolicy: 'drop',
      isEphemeral: true,
    });
    expect(decision.deliverability).toBe('never');
    expect(decision.dropped).toBe(true);
    expect(decision.reason).toBe('blackout_dropped');
  });

  it('holds non-ephemeral events even with drop policy', () => {
    const wallMs = 1_000_000_000;
    const state = {
      effectiveDelayMs: 1280,
      inBlackout: true,
      blackoutLabel: 'Farside-Blackout',
      overrideActive: false,
      computedAt: wallMs,
    };
    const decision = computeDelivery(state, wallMs, {
      blackoutPolicy: 'drop',
      isEphemeral: false, // non-ephemeral must be held
    });
    expect(decision.deliverability).toBe('later');
    expect(decision.dropped).toBe(false);
    expect(decision.heldByBlackout).toBe(true);
  });

  it('holds without releaseAt when blackoutEndMs is not provided', () => {
    const wallMs = 1_000_000_000;
    const state = {
      effectiveDelayMs: 1280,
      inBlackout: true,
      blackoutLabel: 'Solar-Conjunction',
      overrideActive: false,
      computedAt: wallMs,
    };
    const decision = computeDelivery(state, wallMs, { blackoutPolicy: 'hold' });
    expect(decision.deliverability).toBe('later');
    expect(decision.releaseAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Profile integration smoke tests
// ---------------------------------------------------------------------------

describe('Mission Profiles – integration smoke', () => {
  it('MOON_PROFILE constant delay stays within range', () => {
    const moonLink = MOON_PROFILE.radio;
    const d = effectiveOneWayDelayMs(moonLink, Date.UTC(2024, 6, 1, 0, 0, 0));
    expect(d).toBe(moonLink.delay.minMs); // non-sinusoidal
  });

  it('MARS_PROFILE computes link state without errors at arbitrary wall time', () => {
    const wallMs = Date.UTC(2025, 3, 20, 8, 30, 0);
    const state = computeLinkState(MARS_PROFILE.radio, wallMs);
    expect(typeof state.effectiveDelayMs).toBe('number');
    expect(state.effectiveDelayMs).toBeGreaterThan(0);
    expect(typeof state.inBlackout).toBe('boolean');
  });
});
