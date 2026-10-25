import { z } from 'zod';

export const AuditVerificationResponseSchema = z.object({
  valid: z.boolean(),
  verified_count: z.number().int().nonnegative(),
  total_records: z.number().int().nonnegative(),
  genesis_hash: z.string(),
  latest_hash: z.string(),
  broken_at_sequence: z.number().int().positive().optional(),
  broken_record_id: z.string().optional(),
  reason: z.enum(['SEQUENCE_GAP', 'PREV_HASH_MISMATCH', 'HASH_MISMATCH']).optional(),
  details: z.record(z.unknown()).optional(),
});

export type AuditVerificationResponse = z.infer<typeof AuditVerificationResponseSchema>;
