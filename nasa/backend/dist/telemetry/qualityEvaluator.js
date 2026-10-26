/**
 * Determines the primary quality flag given a set of reason tags.
 * Severity order: dropout > implausible > spike > flatline > interpolated > ok.
 */
export function resolvePrimaryFlag(reasons) {
    if (reasons.includes('dropout'))
        return 'dropout';
    if (reasons.includes('implausible_value'))
        return 'implausible';
    if (reasons.includes('rate_of_change_exceeded'))
        return 'spike';
    if (reasons.includes('flatline_detected'))
        return 'flatline';
    if (reasons.includes('gap_filled'))
        return 'interpolated';
    return 'ok';
}
/**
 * Pure evaluation function for a single telemetry reading against current stream state.
 * Performs zero I/O and strictly relies on reading timestamps, never the wall clock.
 */
export function evaluateReading(reading, state, config, options = {}, ingestedAt = new Date()) {
    const expectedIntervalS = options.expected_interval_s ?? 1;
    const maxInterpGapS = options.max_interp_gap_s ?? 10;
    const currentState = state
        ? {
            ...state,
            spike_candidates: state.spike_candidates ? [...state.spike_candidates] : [],
        }
        : {
            crew_id: reading.crew_id,
            metric: reading.metric,
            spike_candidates: [],
        };
    const readingTs = reading.timestamp.getTime();
    const reasons = [];
    const interpolated = [];
    let gap;
    // 1. Check out-of-order reading
    if (currentState.latest_timestamp && readingTs < currentState.latest_timestamp.getTime()) {
        reasons.push('out_of_order');
        // Rule: Out-of-order reading is still evaluated for dropout / plausibility,
        // but does NOT update stream state or trigger interpolation.
        if (reading.value === null) {
            reasons.push('dropout');
        }
        else if (!Number.isFinite(reading.value) ||
            reading.value < config.min_plausible ||
            reading.value > config.max_plausible) {
            reasons.push('implausible_value');
        }
        const flag = resolvePrimaryFlag(reasons);
        return {
            reading: {
                ...reading,
                quality: { flag, reasons },
                ingested_at: ingestedAt,
            },
            nextState: currentState, // State untouched
            interpolated: [],
        };
    }
    // 2. Check dropout (value is null)
    if (reading.value === null) {
        reasons.push('dropout');
        // Dropouts reset flatline and spike candidate tracking
        currentState.flatline_start_timestamp = undefined;
        currentState.flatline_value = undefined;
        currentState.spike_candidates = [];
        currentState.latest_timestamp = reading.timestamp;
        currentState.last_activity_reading_time = reading.timestamp;
        currentState.last_activity_wall_time = Date.now();
        const flag = resolvePrimaryFlag(reasons);
        return {
            reading: {
                ...reading,
                quality: { flag, reasons },
                ingested_at: ingestedAt,
            },
            nextState: currentState,
            interpolated: [],
        };
    }
    const val = reading.value;
    // 3. Check implausible
    if (!Number.isFinite(val) || val < config.min_plausible || val > config.max_plausible) {
        reasons.push('implausible_value');
        // Implausible readings reset flatline and spike tracking
        currentState.flatline_start_timestamp = undefined;
        currentState.flatline_value = undefined;
        currentState.spike_candidates = [];
        currentState.latest_timestamp = reading.timestamp;
        currentState.last_activity_reading_time = reading.timestamp;
        currentState.last_activity_wall_time = Date.now();
        const flag = resolvePrimaryFlag(reasons);
        return {
            reading: {
                ...reading,
                quality: { flag, reasons },
                ingested_at: ingestedAt,
            },
            nextState: currentState,
            interpolated: [],
        };
    }
    // 4. Flatline check
    if (currentState.flatline_start_timestamp === undefined ||
        currentState.flatline_value === undefined ||
        Math.abs(val - currentState.flatline_value) > config.flatline_epsilon) {
        // Value changed or first valid reading: reset flatline window
        currentState.flatline_start_timestamp = reading.timestamp;
        currentState.flatline_value = val;
    }
    else {
        // Value unchanged within epsilon: check duration
        const flatlineDurationS = (readingTs - currentState.flatline_start_timestamp.getTime()) / 1000;
        if (flatlineDurationS >= config.flatline_window_s) {
            reasons.push('flatline_detected');
        }
    }
    // 5. Spike and Level-Shift check
    let isLevelShiftAccepted = false;
    if (currentState.last_good_value !== undefined &&
        currentState.last_good_timestamp !== undefined) {
        const elapsedSinceLastGoodS = (readingTs - currentState.last_good_timestamp.getTime()) / 1000;
        if (elapsedSinceLastGoodS > 0) {
            const rate = Math.abs(val - currentState.last_good_value) / elapsedSinceLastGoodS;
            if (rate > config.max_rate_per_s) {
                // Potential spike detected. Check level shift safety rule:
                // If 3 consecutive spike candidates are consistent with each other within tolerance,
                // accept them as a genuine level shift!
                const existingCandidates = currentState.spike_candidates ?? [];
                const isConsistent = existingCandidates.length === 0 ||
                    existingCandidates.every((c) => Math.abs(val - c.value) <= config.level_shift_tolerance);
                if (isConsistent) {
                    existingCandidates.push({ timestamp: reading.timestamp, value: val });
                    currentState.spike_candidates = existingCandidates;
                }
                else {
                    // Inconsistent with previous candidates: restart candidate list with this reading
                    currentState.spike_candidates = [{ timestamp: reading.timestamp, value: val }];
                }
                if (currentState.spike_candidates.length >= 3) {
                    // Level shift confirmed!
                    isLevelShiftAccepted = true;
                    reasons.push('level_shift_accepted');
                    currentState.spike_candidates = [];
                }
                else {
                    reasons.push('rate_of_change_exceeded');
                }
            }
            else {
                // Rate is within normal bounds: clear any pending spike candidates
                currentState.spike_candidates = [];
            }
        }
    }
    // Determine current candidate flag
    const currentFlag = resolvePrimaryFlag(reasons);
    // 6. Gap handling & Linear Interpolation
    // If the reading qualifies as 'ok' (or level shift accepted) and there was a prior good reading:
    if (currentFlag === 'ok' &&
        currentState.last_good_timestamp !== undefined &&
        currentState.last_good_value !== undefined) {
        const gapS = (readingTs - currentState.last_good_timestamp.getTime()) / 1000;
        if (gapS > 1.5 * expectedIntervalS) {
            if (gapS <= maxInterpGapS) {
                // Gap is within allowed interpolation window: generate linearly interpolated readings
                const lastTs = currentState.last_good_timestamp.getTime();
                const lastVal = currentState.last_good_value;
                const totalDurationMs = readingTs - lastTs;
                const stepMs = expectedIntervalS * 1000;
                let curStepTs = lastTs + stepMs;
                while (curStepTs < readingTs) {
                    const ratio = (curStepTs - lastTs) / totalDurationMs;
                    const interpVal = Number((lastVal + (val - lastVal) * ratio).toFixed(4));
                    interpolated.push({
                        crew_id: reading.crew_id,
                        metric: reading.metric,
                        value: interpVal,
                        unit: reading.unit,
                        timestamp: new Date(curStepTs),
                        source: reading.source,
                        dataset_id: reading.dataset_id,
                        device_id: reading.device_id,
                        mission_day: reading.mission_day,
                        batch_id: reading.batch_id,
                        quality: {
                            flag: 'interpolated',
                            reasons: ['gap_filled'],
                        },
                        ingested_at: ingestedAt,
                    });
                    curStepTs += stepMs;
                }
            }
            else {
                // Gap exceeds max interpolation gap: record gap
                gap = {
                    crew_id: reading.crew_id,
                    metric: reading.metric,
                    from: currentState.last_good_timestamp.toISOString(),
                    to: reading.timestamp.toISOString(),
                    seconds: Number(gapS.toFixed(3)),
                };
            }
        }
    }
    // 7. Update stream state for good readings
    if (currentFlag === 'ok' || isLevelShiftAccepted) {
        currentState.last_good_value = val;
        currentState.last_good_timestamp = reading.timestamp;
    }
    currentState.latest_timestamp = reading.timestamp;
    currentState.last_activity_reading_time = reading.timestamp;
    currentState.last_activity_wall_time = Date.now();
    const evaluatedReading = {
        ...reading,
        quality: {
            flag: currentFlag,
            reasons,
        },
        ingested_at: ingestedAt,
    };
    return {
        reading: evaluatedReading,
        nextState: currentState,
        interpolated,
        gap,
    };
}
