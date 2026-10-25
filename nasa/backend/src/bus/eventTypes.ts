import { z } from 'zod';

export const TOPICS = ['alerts', 'emergency', 'system', 'telemetry'] as const;
export type Topic = (typeof TOPICS)[number];

export const REPLAYABLE_TOPICS: readonly Topic[] = ['alerts', 'emergency', 'system'] as const;
export const EPHEMERAL_TOPICS: readonly Topic[] = ['telemetry'] as const;

export const AUDIENCES = ['all', 'crew', 'ground'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type EventSeverity = (typeof SEVERITIES)[number];

export const MISSION_MODES = ['iss', 'moon', 'mars'] as const;
export type MissionMode = (typeof MISSION_MODES)[number];

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
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_ORIGINS = ['onboard', 'ground', 'system'] as const;
export type EventOrigin = (typeof EVENT_ORIGINS)[number];

export const DeliveryTargetSchema = z.enum(['ground', 'onboard']);
export type DeliveryTarget = z.infer<typeof DeliveryTargetSchema>;

export const DeliveryMetadataSchema = z.object({
  target: DeliveryTargetSchema,
  delay_ms: z.number().min(0),
  release_at: z.string().datetime(),
  held_by_blackout: z.boolean(),
  dropped: z.boolean(),
});
export type DeliveryMetadata = z.infer<typeof DeliveryMetadataSchema>;

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

export type Envelope = z.infer<typeof EnvelopeSchema>;

/**
 * Input to EventBus.publish(). Optional metadata fields are filled by the bus if omitted.
 */
export interface NewEvent {
  uid?: string;
  topic: Topic;
  type: EventType | string;
  crew_id?: string | null;
  severity?: EventSeverity | null;
  audience?: Audience;
  origin?: EventOrigin;
  delivery?: DeliveryMetadata;
  emitted_at?: string;
  mission_mode?: MissionMode;
  request_id?: string | null;
  payload: Record<string, unknown>;
}

/**
 * Helper to compare Redis/Memory stream ids formatted as "<timestampMs>-<seq>".
 * Returns negative if idA < idB, 0 if equal, positive if idA > idB.
 */
export function compareStreamIds(idA: string, idB: string): number {
  if (idA === idB) return 0;

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
export function idBefore(id: string): string {
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
export function isValidStreamId(id: string): boolean {
  return /^\d+-\d+$/.test(id);
}
