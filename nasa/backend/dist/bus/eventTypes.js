import { z } from 'zod';
export const TOPICS = ['alerts', 'emergency', 'system', 'telemetry'];
export const REPLAYABLE_TOPICS = ['alerts', 'emergency', 'system'];
export const EPHEMERAL_TOPICS = ['telemetry'];
export const AUDIENCES = ['all', 'crew', 'ground'];
export const SEVERITIES = ['info', 'warning', 'critical'];
export const MISSION_MODES = ['iss', 'moon', 'mars'];
export const EVENT_TYPES = [
    'alert.raised',
    'alert.updated',
    'alert.cleared',
    'emergency.declared',
    'emergency.acknowledged',
    'emergency.resolved',
    'emergency.cancelled',
    'telemetry.update',
    'system.notice',
    'inbox.raised',
    'inbox.updated',
    'inbox.status_changed',
    'radiation.update',
];
export const EVENT_ORIGINS = ['onboard', 'ground', 'system'];
export const DeliveryTargetSchema = z.enum(['ground', 'onboard']);
export const DeliveryMetadataSchema = z.object({
    target: DeliveryTargetSchema,
    delay_ms: z.number().min(0),
    release_at: z.string().datetime(),
    held_by_blackout: z.boolean(),
    dropped: z.boolean(),
});
/**
 * Envelope Zod Schema for validation and runtime checks.
 */
export const EnvelopeSchema = z.object({
    uid: z.string().uuid(),
    id: z.string().nullable(),
    topic: z.enum(TOPICS),
    type: z.string().min(1),
    crew_id: z.string().optional().nullable(),
    severity: z.enum(SEVERITIES).optional().nullable(),
    audience: z.enum(AUDIENCES).default('all'),
    origin: z.enum(EVENT_ORIGINS).default('onboard').optional(),
    delivery: DeliveryMetadataSchema.optional(),
    emitted_at: z.string().datetime(),
    mission_mode: z.enum(MISSION_MODES),
    request_id: z.string().optional().nullable(),
    payload: z.record(z.unknown()),
});
/**
 * Helper to compare Redis/Memory stream ids formatted as "<timestampMs>-<seq>".
 * Returns negative if idA < idB, 0 if equal, positive if idA > idB.
 */
export function compareStreamIds(idA, idB) {
    if (idA === idB)
        return 0;
    const [msAStr, seqAStr] = idA.split('-');
    const [msBStr, seqBStr] = idB.split('-');
    const msA = BigInt(msAStr ?? '0');
    const msB = BigInt(msBStr ?? '0');
    if (msA !== msB) {
        return msA < msB ? -1 : 1;
    }
    const seqA = BigInt(seqAStr ?? '0');
    const seqB = BigInt(seqBStr ?? '0');
    if (seqA !== seqB) {
        return seqA < seqB ? -1 : 1;
    }
    return 0;
}
/**
 * Returns the stream ID immediately preceding the given ID.
 * - If seq > 0: same ms, seq - 1.
 * - If seq == 0: ms - 1 with the maximum sequence number (18446744073709551615).
 */
export function idBefore(id) {
    const [msStr, seqStr] = id.split('-');
    const ms = BigInt(msStr ?? '0');
    const seq = BigInt(seqStr ?? '0');
    if (seq > 0n) {
        return `${ms}-${seq - 1n}`;
    }
    if (ms > 0n) {
        // 64-bit unsigned max seq in Redis stream protocol
        return `${ms - 1n}-18446744073709551615`;
    }
    return '0-0';
}
/**
 * Validates whether a string is a valid stream id ("<digits>-<digits>").
 */
export function isValidStreamId(id) {
    return /^\d+-\d+$/.test(id);
}
