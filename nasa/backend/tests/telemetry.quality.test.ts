import { describe, it, expect } from 'vitest';
import {
  evaluateReading,
  resolvePrimaryFlag,
  type InputReading,
  type StreamQualityState,
} from '../src/telemetry/qualityEvaluator.js';
import { DEFAULT_QUALITY_CONFIGS } from '../src/telemetry/qualityConfig.js';
import { isAlertEligible } from '../src/telemetry/alertEligibility.js';
import { InMemoryTelemetryPublisher } from '../src/telemetry/publisher.js';

describe('Signal Quality & Missing-Data Evaluator (F019)', () => {
  const crewId = '660e8400e29b41d4a7164466';
  const baseTime = new Date('2026-10-18T10:00:00.000Z');

  function makeReading(overrides: Partial<InputReading>): InputReading {
    return {
      crew_id: crewId,
      metric: 'heart_rate',
      value: 75,
      timestamp: baseTime,
      source: 'simulated',
      ...overrides,
    };
  }

  it('flags null value as dropout', () => {
    const config = DEFAULT_QUALITY_CONFIGS['heart_rate']!;
    const reading = makeReading({ value: null });

    const result = evaluateReading(reading, undefined, config);

    expect(result.reading.quality.flag).toBe('dropout');
    expect(result.reading.quality.reasons).toContain('dropout');
    expect(result.reading.value).toBeNull();
  });

  it('flags out-of-range and sentinels as implausible', () => {
    const config = DEFAULT_QUALITY_CONFIGS['heart_rate']!; // plausible: 20-250

    // Below plausible minimum
    const below = evaluateReading(makeReading({ value: 19.9 }), undefined, config);
    expect(below.reading.quality.flag).toBe('implausible');
    expect(below.reading.quality.reasons).toContain('implausible_value');

    // Above plausible maximum
    const above = evaluateReading(makeReading({ value: 250.1 }), undefined, config);
    expect(above.reading.quality.flag).toBe('implausible');
    expect(above.reading.quality.reasons).toContain('implausible_value');

    // Sentinel -999
    const sentinel = evaluateReading(makeReading({ value: -999 }), undefined, config);
    expect(sentinel.reading.quality.flag).toBe('implausible');
    expect(sentinel.reading.quality.reasons).toContain('implausible_value');

    // NaN or Infinite
    const nonFinite = evaluateReading(makeReading({ value: Infinity }), undefined, config);
    expect(nonFinite.reading.quality.flag).toBe('implausible');
  });

  it('keeps genuine clinical emergencies as ok (e.g. SpO2 of 60)', () => {
    const spo2Config = DEFAULT_QUALITY_CONFIGS['spo2']!; // plausible: 50-100

    const reading = makeReading({
      metric: 'spo2',
      value: 60,
    });

    const result = evaluateReading(reading, undefined, spo2Config);
    expect(result.reading.quality.flag).toBe('ok');
    expect(result.reading.quality.reasons).toHaveLength(0);
  });

  it('detects flatline when unchanged beyond flatline window and recovers on value change', () => {
    const config = DEFAULT_QUALITY_CONFIGS['heart_rate']!; // window: 15s, epsilon: 0.01

    let state: StreamQualityState | undefined = undefined;
    const startTime = baseTime.getTime();

    // Send constant value 75 for 14 seconds (under window)
    for (let s = 0; s <= 14; s++) {
      const res = evaluateReading(
        makeReading({
          value: 75,
          timestamp: new Date(startTime + s * 1000),
        }),
        state,
        config,
      );
      state = res.nextState;
      expect(res.reading.quality.flag).toBe('ok');
    }

    // At 15 seconds, flatline window is reached -> flag as flatline
    const flatline15 = evaluateReading(
      makeReading({
        value: 75,
        timestamp: new Date(startTime + 15 * 1000),
      }),
      state,
      config,
    );
    state = flatline15.nextState;
    expect(flatline15.reading.quality.flag).toBe('flatline');
    expect(flatline15.reading.quality.reasons).toContain('flatline_detected');

    // Remains flatlined at 16s
    const flatline16 = evaluateReading(
      makeReading({
        value: 75,
        timestamp: new Date(startTime + 16 * 1000),
      }),
      state,
      config,
    );
    state = flatline16.nextState;
    expect(flatline16.reading.quality.flag).toBe('flatline');

    // Recovers immediately when value changes beyond epsilon
    const recovery = evaluateReading(
      makeReading({
        value: 76, // Change > 0.01
        timestamp: new Date(startTime + 17 * 1000),
      }),
      state,
      config,
    );
    expect(recovery.reading.quality.flag).toBe('ok');
    expect(recovery.reading.quality.reasons).not.toContain('flatline_detected');
  });

  it('flags instantaneous spikes violating max rate of change', () => {
    const config = DEFAULT_QUALITY_CONFIGS['heart_rate']!; // max rate: 25 / s

    // Initial good reading at 75 bpm
    const r1 = evaluateReading(
      makeReading({ value: 75, timestamp: new Date(baseTime.getTime()) }),
      undefined,
      config,
    );
    expect(r1.reading.quality.flag).toBe('ok');

    // 1 second later, sudden jump to 130 bpm (delta 55 > 25)
    const r2 = evaluateReading(
      makeReading({ value: 130, timestamp: new Date(baseTime.getTime() + 1000) }),
      r1.nextState,
      config,
    );
    expect(r2.reading.quality.flag).toBe('spike');
    expect(r2.reading.quality.reasons).toContain('rate_of_change_exceeded');
  });

  it('accepts genuine level shift after 3 consistent spike readings', () => {
    const config = DEFAULT_QUALITY_CONFIGS['heart_rate']!; // max rate: 25/s, level_shift_tolerance: 5

    // Initial good reading: 75 bpm
    let res = evaluateReading(
      makeReading({ value: 75, timestamp: new Date(baseTime.getTime()) }),
      undefined,
      config,
    );
    expect(res.reading.quality.flag).toBe('ok');

    // Spike candidate 1 at t=1: 160 bpm (delta 85/1 = 85 > 25)
    res = evaluateReading(
      makeReading({ value: 160, timestamp: new Date(baseTime.getTime() + 1000) }),
      res.nextState,
      config,
    );
    expect(res.reading.quality.flag).toBe('spike');

    // Spike candidate 2 at t=2: 161 bpm (delta 86/2 = 43 > 25, consistent within 5 of candidate 1)
    res = evaluateReading(
      makeReading({ value: 161, timestamp: new Date(baseTime.getTime() + 2000) }),
      res.nextState,
      config,
    );
    expect(res.reading.quality.flag).toBe('spike');

    // Spike candidate 3 at t=3: 159 bpm (delta 84/3 = 28 > 25, 3rd consecutive consistent reading -> LEVEL SHIFT ACCEPTED)
    res = evaluateReading(
      makeReading({ value: 159, timestamp: new Date(baseTime.getTime() + 3000) }),
      res.nextState,
      config,
    );
    expect(res.reading.quality.flag).toBe('ok');
    expect(res.reading.quality.reasons).toContain('level_shift_accepted');
    expect(res.nextState.last_good_value).toBe(159);
  });

  it('linearly interpolates gaps within ASTRO_TELEMETRY_MAX_INTERP_GAP_S and reports larger gaps', () => {
    const config = DEFAULT_QUALITY_CONFIGS['heart_rate']!;

    // Initial reading at t=0, val=70
    let res = evaluateReading(
      makeReading({ value: 70, timestamp: new Date(baseTime.getTime()) }),
      undefined,
      config,
      { expected_interval_s: 1, max_interp_gap_s: 10 },
    );

    // Reading at t=4s (gap = 4s > 1.5s and <= 10s), val=78
    res = evaluateReading(
      makeReading({ value: 78, timestamp: new Date(baseTime.getTime() + 4000) }),
      res.nextState,
      config,
      { expected_interval_s: 1, max_interp_gap_s: 10 },
    );

    expect(res.reading.quality.flag).toBe('ok');
    expect(res.interpolated).toHaveLength(3); // t=1, t=2, t=3
    expect(res.interpolated[0]!.value).toBe(72);
    expect(res.interpolated[0]!.quality.flag).toBe('interpolated');
    expect(res.interpolated[0]!.quality.reasons).toContain('gap_filled');
    expect(res.interpolated[1]!.value).toBe(74);
    expect(res.interpolated[2]!.value).toBe(76);
    expect(res.gap).toBeUndefined();

    // Now test a gap > 10s (e.g. 15s, value changes to 80 so it's not a flatline)
    const longGapRes = evaluateReading(
      makeReading({ value: 80, timestamp: new Date(baseTime.getTime() + 19000) }), // 15s after t=4
      res.nextState,
      config,
      { expected_interval_s: 1, max_interp_gap_s: 10 },
    );

    expect(longGapRes.interpolated).toHaveLength(0);
    expect(longGapRes.gap).toBeDefined();
    expect(longGapRes.gap?.seconds).toBe(15);
  });

  it('marks out-of-order reading with out_of_order reason without modifying stream state', () => {
    const config = DEFAULT_QUALITY_CONFIGS['heart_rate']!;

    // Stream at t=10s
    const r1 = evaluateReading(
      makeReading({ value: 75, timestamp: new Date(baseTime.getTime() + 10000) }),
      undefined,
      config,
    );
    expect(r1.nextState.latest_timestamp?.getTime()).toBe(baseTime.getTime() + 10000);

    // Reading arriving late with timestamp at t=5s
    const late = evaluateReading(
      makeReading({ value: 74, timestamp: new Date(baseTime.getTime() + 5000) }),
      r1.nextState,
      config,
    );

    expect(late.reading.quality.reasons).toContain('out_of_order');
    expect(late.reading.quality.flag).toBe('ok');
    // State is untouched
    expect(late.nextState.latest_timestamp?.getTime()).toBe(baseTime.getTime() + 10000);
    expect(late.interpolated).toHaveLength(0);
  });

  it('evaluates accelerated timestamps (10x replay) identically to wall clock', () => {
    const config = DEFAULT_QUALITY_CONFIGS['heart_rate']!;
    let state: StreamQualityState | undefined = undefined;

    // 10x accelerated simulation (readings arrive at simulated 1s steps)
    const startTime = baseTime.getTime();
    for (let i = 0; i <= 20; i++) {
      const reading = makeReading({
        value: 80,
        timestamp: new Date(startTime + i * 1000), // reading timestamp progresses
      });
      const res = evaluateReading(reading, state, config);
      state = res.nextState;

      if (i < 15) {
        expect(res.reading.quality.flag).toBe('ok');
      } else {
        expect(res.reading.quality.flag).toBe('flatline');
      }
    }
  });

  it('flags 100% of injected dropouts and impossible values in a 1,000-reading synthetic stream', () => {
    const config = DEFAULT_QUALITY_CONFIGS['heart_rate']!;
    let state: StreamQualityState | undefined = undefined;
    const start = baseTime.getTime();

    let dropoutsInjected = 0;
    let impossibleInjected = 0;
    let dropoutsDetected = 0;
    let impossibleDetected = 0;

    for (let i = 0; i < 1000; i++) {
      let val: number | null = 70 + (i % 10);
      const isDropout = i % 50 === 0;
      const isImpossible = i % 70 === 0 && !isDropout;

      if (isDropout) {
        val = null;
        dropoutsInjected++;
      } else if (isImpossible) {
        val = -999;
        impossibleInjected++;
      }

      const res = evaluateReading(
        makeReading({ value: val, timestamp: new Date(start + i * 1000) }),
        state,
        config,
      );
      state = res.nextState;

      if (res.reading.quality.flag === 'dropout') dropoutsDetected++;
      if (res.reading.quality.flag === 'implausible') impossibleDetected++;
    }

    expect(dropoutsDetected).toBe(dropoutsInjected);
    expect(impossibleDetected).toBe(impossibleInjected);
  });

  it('produces 0 false flags in a clean noisy 1-hour synthetic stream', () => {
    const config = DEFAULT_QUALITY_CONFIGS['heart_rate']!;
    let state: StreamQualityState | undefined = undefined;
    const start = baseTime.getTime();
    let flaggedCount = 0;

    // 3,600 readings (1 hour at 1 Hz), subtle physiological jitter within 68 - 82 bpm
    for (let i = 0; i < 3600; i++) {
      // Natural sinus rhythm variation (small sine wave + random-like jitter)
      const val = Number((75 + 4 * Math.sin(i / 60) + (i % 3) * 0.5).toFixed(2));

      const res = evaluateReading(
        makeReading({ value: val, timestamp: new Date(start + i * 1000) }),
        state,
        config,
      );
      state = res.nextState;

      if (res.reading.quality.flag !== 'ok') {
        flaggedCount++;
      }
    }

    expect(flaggedCount).toBe(0);
  });

  it('correctly orders flag severity: dropout > implausible > spike > flatline > interpolated > ok', () => {
    expect(resolvePrimaryFlag(['dropout', 'flatline_detected'])).toBe('dropout');
    expect(resolvePrimaryFlag(['implausible_value', 'rate_of_change_exceeded'])).toBe(
      'implausible',
    );
    expect(resolvePrimaryFlag(['rate_of_change_exceeded', 'flatline_detected'])).toBe('spike');
    expect(resolvePrimaryFlag(['flatline_detected', 'gap_filled'])).toBe('flatline');
    expect(resolvePrimaryFlag(['gap_filled'])).toBe('interpolated');
    expect(resolvePrimaryFlag([])).toBe('ok');
  });

  it('verifies alert eligibility: only ok readings may raise alerts', () => {
    expect(isAlertEligible({ quality: { flag: 'ok', reasons: [] } })).toBe(true);
    expect(isAlertEligible({ quality: { flag: 'dropout', reasons: ['dropout'] } })).toBe(false);
    expect(
      isAlertEligible({ quality: { flag: 'implausible', reasons: ['implausible_value'] } }),
    ).toBe(false);
    expect(
      isAlertEligible({ quality: { flag: 'spike', reasons: ['rate_of_change_exceeded'] } }),
    ).toBe(false);
    expect(isAlertEligible({ quality: { flag: 'flatline', reasons: ['flatline_detected'] } })).toBe(
      false,
    );
    expect(isAlertEligible({ quality: { flag: 'interpolated', reasons: ['gap_filled'] } })).toBe(
      false,
    );
  });

  it('publisher isolates subscriber errors without failing or blocking', () => {
    const publisher = new InMemoryTelemetryPublisher();
    let called = false;

    publisher.subscribe(() => {
      throw new Error('Exploding subscriber');
    });

    publisher.subscribe((evt) => {
      called = true;
      expect(evt.readings).toHaveLength(1);
    });

    // Should not throw
    expect(() => {
      publisher.publish({
        batch_id: 'test',
        readings: [
          {
            ...makeReading({}),
            quality: { flag: 'ok', reasons: [] },
            ingested_at: new Date(),
          },
        ],
      });
    }).not.toThrow();

    expect(called).toBe(true);
  });
});
