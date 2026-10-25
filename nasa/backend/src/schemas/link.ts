/**
 * @module schemas/link
 * Zod schemas for Link State, DTN Store-and-Forward Queue, and Link Overrides (Phase 4).
 */

import { z } from 'zod';

export const LinkStateDTOSchema = z.object({
  effective_delay_ms: z.number().describe('Current one-way comms delay in ms'),
  in_blackout: z.boolean().describe('True if link is in a blackout window'),
  blackout_label: z.string().nullable().describe('Active blackout label or null'),
  packet_loss_rate: z.number().describe('Current packet loss rate (0.0 to 1.0)'),
  override_active: z.boolean().describe('True if administrative override is active'),
  mission_mode: z.string().describe('Active mission mode (iss, moon, mars)'),
  computed_at: z.number().describe('Epoch millisecond timestamp of state calculation'),
});
export type LinkStateDTO = z.infer<typeof LinkStateDTOSchema>;

export const LinkOverrideBodySchema = z.object({
  direction: z
    .enum(['uplink', 'downlink'])
    .default('downlink')
    .describe('Comms direction to override'),
  force_delay_ms: z.number().int().min(0).optional().describe('Forced one-way delay in ms'),
  force_blackout: z.boolean().optional().describe('Forced blackout state'),
  force_packet_loss_rate: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Forced packet loss rate (0.0 to 1.0)'),
  expires_in_seconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Duration in seconds until override expires'),
});
export type LinkOverrideBody = z.infer<typeof LinkOverrideBodySchema>;

export const DtnSendBodySchema = z.object({
  direction: z.enum(['uplink', 'downlink']).default('uplink').describe('Message direction'),
  type: z.string().min(1).describe('Message type descriptor'),
  target_id: z.string().optional().describe('Target entity ID (e.g. emergencyId, protocolId)'),
  payload: z.record(z.unknown()).default({}).describe('Structured message payload'),
  idempotency_key: z.string().min(1).describe('Client idempotency key for deduplication'),
});
export type DtnSendBody = z.infer<typeof DtnSendBodySchema>;

export const DtnConflictResolutionSchema = z.object({
  resolved: z.boolean(),
  policy: z.enum(['onboard_wins', 'ground_wins', 'merged']),
  winner_message_id: z.string().nullable(),
  details: z.string(),
  reconciled_at: z.string(),
  reconciled_by: z.string().nullable(),
});

export const DtnMessageDTOSchema = z.object({
  message_id: z.string(),
  direction: z.enum(['uplink', 'downlink']),
  sender_id: z.string(),
  sender_role: z.string(),
  type: z.string(),
  target_id: z.string().nullable(),
  payload: z.record(z.unknown()),
  sequence_number: z.number(),
  idempotency_key: z.string(),
  status: z.enum(['queued', 'in_flight', 'delivered', 'dropped', 'conflict']),
  created_at: z.string(),
  release_at: z.string().nullable(),
  delivered_at: z.string().nullable(),
  conflict_resolution: DtnConflictResolutionSchema.nullable().optional(),
});
export type DtnMessageDTO = z.infer<typeof DtnMessageDTOSchema>;

export const DtnSyncResponseSchema = z.object({
  ok: z.boolean(),
  link_state: z.object({
    in_blackout: z.boolean(),
    effective_delay_ms: z.number(),
  }),
  synced_count: z.number(),
  delivered_count: z.number(),
  conflicts_count: z.number(),
  messages: z.array(DtnMessageDTOSchema),
});
export type DtnSyncResponse = z.infer<typeof DtnSyncResponseSchema>;

export const LinkEventDTOSchema = z.object({
  id: z.string(),
  kind: z.string(),
  mission_mode: z.string(),
  delay_ms: z.number(),
  in_blackout: z.boolean(),
  blackout_label: z.string().nullable(),
  override_active: z.boolean(),
  occurred_at: z.string(),
});
