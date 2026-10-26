/**
 * @module schemas/protocols
 * Zod schemas for Onboard Clinical Protocols & Autonomous Decision Support (Phase 4).
 */
import { z } from 'zod';
export const HazardTypeSchema = z.enum([
    'cardiovascular',
    'respiratory',
    'thermal',
    'autonomic_stress',
    'cabin_environment',
    'radiation',
]);
export const StepCriticalitySchema = z.enum(['critical', 'standard', 'monitoring']);
export const ProtocolStepSchema = z.object({
    step_id: z.string().describe('Unique step identifier within the protocol'),
    order: z.number().int().describe('Sequential step execution order'),
    title: z.string().describe('Short title of clinical intervention'),
    instruction: z.string().describe('Detailed clinical instructions for Crew Medical Officer'),
    criticality: StepCriticalitySchema.describe('Urgency / life-safety criticality level'),
    expected_telemetry_effect: z
        .string()
        .describe('Expected physiological or environmental response'),
    requires_cmo_confirmation: z.boolean().describe('Whether explicit CMO sign-off is required'),
});
export const ProtocolChecklistSchema = z.object({
    protocol_id: z.string().describe('Unique protocol identifier (e.g. PROTO-CV-01)'),
    hazard_type: HazardTypeSchema.describe('Primary hazard type'),
    title: z.string().describe('Protocol name and clinical indication'),
    version: z.string().describe('Protocol clinical revision version'),
    indication: z.string().describe('Clinical diagnosis and indications triggering this protocol'),
    autonomous_priority: z.enum(['immediate', 'urgent', 'routine']),
    steps: z.array(ProtocolStepSchema).describe('Ordered procedural checklist steps'),
});
export const CompleteProtocolStepBodySchema = z.object({
    emergency_id: z.string().optional().describe('Active emergency UUID if linked'),
    crew_id: z.string().optional().describe('Astronaut crew profile ID receiving care'),
    action_taken: z.string().min(1).describe('Clinical action executed by Crew Medical Officer'),
    notes: z.string().optional().describe('CMO clinical observations and vitals response'),
    vital_signs_snapshot: z
        .record(z.unknown())
        .optional()
        .describe('Snapshot of vital signs at execution time'),
});
export const ReconcileDecisionsBodySchema = z.object({
    decision_ids: z
        .array(z.string())
        .min(1)
        .describe('Array of autonomous decision UUIDs to reconcile'),
    review_notes: z.string().min(1).describe('Ground Flight Surgeon clinical review comments'),
    status: z.enum(['accepted', 'amended', 'flagged']).describe('Reconciliation outcome status'),
});
export const ProtocolsListResponseSchema = z.object({
    autonomous_mode_active: z.boolean(),
    link_state: z.object({
        in_blackout: z.boolean(),
        effective_delay_ms: z.number(),
    }),
    protocols: z.array(ProtocolChecklistSchema),
});
export const ProtocolDetailResponseSchema = z.object({
    autonomous_mode_active: z.boolean(),
    protocol: ProtocolChecklistSchema,
});
export const AutonomousDecisionLogDTOSchema = z.object({
    decision_id: z.string(),
    protocol_id: z.string(),
    step_id: z.string(),
    emergency_id: z.string().nullable(),
    actor_id: z.string(),
    actor_role: z.string(),
    action_taken: z.string(),
    notes: z.string(),
    crew_id: z.string().nullable(),
    vital_signs_snapshot: z.record(z.unknown()),
    link_state_at_decision: z.object({
        in_blackout: z.boolean(),
        effective_delay_ms: z.number(),
    }),
    reconciled: z.boolean(),
    reconciled_at: z.string().nullable(),
    reconciled_by: z.string().nullable(),
    reconciliation_status: z.enum(['accepted', 'amended', 'flagged']).nullable(),
    reconciliation_notes: z.string().nullable(),
    created_at: z.string(),
});
export const ReconcileDecisionsResponseSchema = z.object({
    reconciled_count: z.number(),
    decisions: z.array(AutonomousDecisionLogDTOSchema),
});
