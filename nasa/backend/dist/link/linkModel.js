/**
 * @module linkModel
 * Pure functions for the Communications Delay Emulator (F070).
 *
 * NO I/O, NO wall-clock calls, NO external dependencies.
 * All functions accept time as explicit parameters for deterministic testability.
 *
 * Key functions
 * -------------
 * - `effectiveOneWayDelayMs`  — current one-way delay for a profile + wall time
 * - `resolveBlackoutWindows`  — maps fraction-based blackout defs → wall-ms windows
 * - `mergeWindows`            — union-merges sorted window arrays
 * - `isInBlackout`            — O(log n) blackout membership check
 * - `computeLinkState`        — full link state snapshot (delay + blackout)
 * - `computeDelivery`         — DeliveryDecision for a single event
 */
// ---------------------------------------------------------------------------
// Delay Computation
// ---------------------------------------------------------------------------
/**
 * Computes the effective one-way delay (ms) for a radio link at wall time `wallMs`.
 *
 * For sinusoidal links (Mars) the delay oscillates between `delay.minMs` and
 * `delay.maxMs` with the given sinusoidal period.
 * Formula: delay = midpoint + amplitude * sin(2π * wallMs / periodMs)
 *
 * For non-sinusoidal links returns `delay.minMs` (constant baseline).
 */
export function effectiveOneWayDelayMs(link, wallMs) {
    const { minMs, maxMs } = link.delay;
    if (!link.sinusoidalDelay) {
        return minMs;
    }
    const amplitude = (maxMs - minMs) / 2;
    const midpoint = (maxMs + minMs) / 2;
    const periodMs = link.sinusoidPeriodS * 1000;
    const sinValue = Math.sin((2 * Math.PI * wallMs) / periodMs);
    return Math.round(midpoint + amplitude * sinValue);
}
// ---------------------------------------------------------------------------
// Blackout Window Resolution
// ---------------------------------------------------------------------------
/**
 * Maps fraction-based BlackoutWindow definitions to concrete wall-clock windows
 * within the 24-hour cycle that contains `refWallMs`.
 *
 * The "24-hour cycle" is anchored at UTC midnight of the day containing `refWallMs`.
 * This makes resolved windows deterministic and timezone-independent.
 *
 * Returns windows sorted by startMs ascending.
 */
export function resolveBlackoutWindows(blackouts, refWallMs) {
    const MS_PER_DAY = 86_400_000;
    // Anchor to UTC midnight of the current day
    const dayStartMs = refWallMs - (refWallMs % MS_PER_DAY);
    return blackouts
        .map((b) => ({
        label: b.label,
        startMs: dayStartMs + Math.floor(b.startFraction * MS_PER_DAY),
        endMs: dayStartMs + Math.floor(b.endFraction * MS_PER_DAY),
    }))
        .sort((a, b) => a.startMs - b.startMs);
}
/**
 * Merges a list of sorted, possibly overlapping window pairs into a minimal
 * set of non-overlapping windows (union-merge).
 *
 * Input must be sorted by startMs ascending.
 * Output is also sorted by startMs ascending.
 */
export function mergeWindows(windows) {
    if (windows.length === 0)
        return [];
    const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
    const merged = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = merged[merged.length - 1];
        if (current.startMs <= last.endMs) {
            // Overlapping — extend the last window
            last.endMs = Math.max(last.endMs, current.endMs);
            last.label = last.label !== current.label ? `${last.label}+${current.label}` : last.label;
        }
        else {
            merged.push({ ...current });
        }
    }
    return merged;
}
/**
 * O(n) check: returns the first blackout window that contains `wallMs`, or null.
 *
 * Windows must be sorted by startMs ascending (as returned by resolveBlackoutWindows / mergeWindows).
 */
export function findActiveBlackout(windows, wallMs) {
    for (const w of windows) {
        if (w.startMs > wallMs)
            break; // windows are sorted; no further window can match
        if (wallMs < w.endMs)
            return w;
    }
    return null;
}
// ---------------------------------------------------------------------------
// Link State Snapshot
// ---------------------------------------------------------------------------
/**
 * Computes a full LinkState snapshot from a RadioLink profile, wall time, and
 * any active administrative override.
 *
 * `wallMs` must be supplied by the caller — this function is deterministic
 * and does not read any clock.
 */
export function computeLinkState(link, wallMs, override) {
    // Resolve blackout windows for the current 24 h cycle
    const rawWindows = resolveBlackoutWindows(link.blackouts, wallMs);
    const windows = mergeWindows(rawWindows);
    const activeBlackout = findActiveBlackout(windows, wallMs);
    // Base computed values
    let effectiveDelayMs = effectiveOneWayDelayMs(link, wallMs);
    let inBlackout = activeBlackout !== null;
    let blackoutLabel = activeBlackout?.label ?? null;
    let packetLossRate = link.packetLossRate ?? 0;
    let overrideActive = false;
    // Apply administrative override if present and not expired
    if (override) {
        const expired = override.expires_at !== undefined && wallMs > override.expires_at;
        if (!expired) {
            overrideActive = true;
            if (override.force_delay_ms !== undefined) {
                effectiveDelayMs = override.force_delay_ms;
            }
            if (override.force_blackout !== undefined) {
                inBlackout = override.force_blackout;
                if (!inBlackout) {
                    blackoutLabel = null;
                }
                else if (blackoutLabel === null) {
                    blackoutLabel = 'admin-forced';
                }
            }
            if (override.force_packet_loss_rate !== undefined) {
                packetLossRate = override.force_packet_loss_rate;
            }
        }
    }
    return {
        effectiveDelayMs,
        inBlackout,
        blackoutLabel,
        packetLossRate,
        overrideActive,
        computedAt: wallMs,
    };
}
/**
 * Computes a DeliveryDecision for a single event given the current LinkState.
 *
 * Pure function: no I/O, no wall-clock reads.
 *
 * @param state     - current link state (from computeLinkState)
 * @param wallMs    - current wall time (epoch ms, must equal state.computedAt)
 * @param opts      - delivery policy options
 */
export function computeDelivery(state, wallMs, opts = {}) {
    const { blackoutPolicy = 'hold', isEphemeral = false, blackoutEndMs } = opts;
    // Case 1: Currently in a blackout
    if (state.inBlackout) {
        const drop = blackoutPolicy === 'drop' && isEphemeral;
        if (drop) {
            return {
                deliverability: 'never',
                releaseAt: undefined,
                delayAppliedMs: 0,
                heldByBlackout: false,
                dropped: true,
                reason: 'blackout_dropped',
            };
        }
        // Hold: release after blackout ends + apply normal link delay
        const releaseAt = blackoutEndMs !== undefined ? blackoutEndMs + state.effectiveDelayMs : undefined;
        return {
            deliverability: 'later',
            releaseAt,
            delayAppliedMs: state.effectiveDelayMs,
            heldByBlackout: true,
            dropped: false,
            reason: 'blackout_held',
        };
    }
    // Case 2: Packet loss check
    const lossRate = state.packetLossRate ?? 0;
    const isLost = opts.simulatePacketLoss === true ||
        (opts.simulatePacketLoss !== false &&
            opts.randomFn !== undefined &&
            opts.randomFn() < lossRate);
    if (isLost) {
        return {
            deliverability: 'never',
            releaseAt: undefined,
            delayAppliedMs: 0,
            heldByBlackout: false,
            dropped: true,
            reason: 'packet_loss',
        };
    }
    // Case 3: Link is live, apply one-way delay
    const releaseAt = wallMs + state.effectiveDelayMs;
    // Treat negligible delay (≤ 100 ms) as "now" to avoid unnecessary queuing
    if (state.effectiveDelayMs <= 100) {
        return {
            deliverability: 'now',
            releaseAt: undefined,
            delayAppliedMs: state.effectiveDelayMs,
            heldByBlackout: false,
            dropped: false,
            reason: 'ok',
        };
    }
    return {
        deliverability: 'later',
        releaseAt,
        delayAppliedMs: state.effectiveDelayMs,
        heldByBlackout: false,
        dropped: false,
        reason: `delayed:${state.effectiveDelayMs}`,
    };
}
