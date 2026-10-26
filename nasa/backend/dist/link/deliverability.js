/**
 * @module deliverability
 * Shared "now | later | never" helper for the comms delay pipeline (Part 2e / F070).
 *
 * Exported separately so Link REST routes and the stamping bus can use it
 * without importing the full emulator.
 */
import { EPHEMERAL_TOPICS } from '../bus/eventTypes.js';
/**
 * Returns whether an envelope should be delivered immediately, after a delay,
 * or dropped (never), given the current link state and delivery policy.
 *
 * @param envelope     - the event envelope being evaluated
 * @param state        - current cached link state
 * @param wallMs       - current wall time (epoch ms)
 * @param dropEphemeral - if true, ephemeral topic events are dropped during blackouts
 */
export function getDeliverability(envelope, state, _wallMs, dropEphemeral) {
    const isEphemeral = EPHEMERAL_TOPICS.includes(envelope.topic);
    // During blackout: drop ephemeral if policy says so, else hold
    if (state.inBlackout) {
        if (dropEphemeral && isEphemeral)
            return 'never';
        return 'later';
    }
    // No blackout: sub-100ms delay treated as immediate
    if (state.effectiveDelayMs <= 100)
        return 'now';
    return 'later';
}
