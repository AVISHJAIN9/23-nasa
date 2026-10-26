/**
 * @module protocolService
 * Onboard Medical Protocol Guidance and Autonomous Decision Service (Phase 4).
 *
 * Exposes medical checklists to the Crew Medical Officer (CMO) during comms delay/blackout,
 * records decisions with link telemetry snapshots, and reconciles decisions with Ground Flight Surgeons.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundError, ForbiddenError, AppError } from '../core/errors.js';
import { AutonomousDecisionLog, } from '../models/AutonomousDecisionLog.js';
import { PROTOCOL_CATALOG } from './protocolCatalog.js';
export class ProtocolService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /**
     * Evaluates if autonomous mode is currently active:
     * link is in blackout OR one-way delay is severe (> 10 seconds).
     */
    async isAutonomousModeActive() {
        const state = await this.deps.emulator.getState();
        return state.inBlackout || state.effectiveDelayMs > 10_000;
    }
    /**
     * Lists available clinical protocols with optional hazard filter.
     */
    async getProtocols(hazardType) {
        const linkState = await this.deps.emulator.getState();
        const autonomousModeActive = linkState.inBlackout || linkState.effectiveDelayMs > 10_000;
        let protocols = PROTOCOL_CATALOG;
        if (hazardType) {
            protocols = protocols.filter((p) => p.hazard_type === hazardType);
        }
        return {
            autonomous_mode_active: autonomousModeActive,
            link_state: {
                in_blackout: linkState.inBlackout,
                effective_delay_ms: linkState.effectiveDelayMs,
            },
            protocols,
        };
    }
    /**
     * Retrieves a single protocol by its protocol_id.
     */
    async getProtocolById(protocolId) {
        const protocol = PROTOCOL_CATALOG.find((p) => p.protocol_id === protocolId);
        if (!protocol) {
            throw new NotFoundError(`Protocol with ID '${protocolId}' not found`);
        }
        const isAuto = await this.isAutonomousModeActive();
        return {
            autonomous_mode_active: isAuto,
            protocol,
        };
    }
    /**
     * Completes a protocol step and logs an autonomous medical decision.
     * Enforces Crew Medical Officer authorization.
     */
    async completeStep(params) {
        // 1. Role validation: Must be Crew Medical Officer or Flight Surgeon or Admin
        const canPrescribe = params.isMedicalOfficer ||
            params.actorRole === 'flight_surgeon' ||
            params.actorRole === 'admin';
        if (!canPrescribe) {
            throw new ForbiddenError('Autonomous clinical interventions require Crew Medical Officer (CMO) or Flight Surgeon authorization');
        }
        // 2. Validate protocol and step
        const protocol = PROTOCOL_CATALOG.find((p) => p.protocol_id === params.protocolId);
        if (!protocol) {
            throw new NotFoundError(`Protocol '${params.protocolId}' not found`);
        }
        const step = protocol.steps.find((s) => s.step_id === params.stepId);
        if (!step) {
            throw new NotFoundError(`Step '${params.stepId}' not found in protocol '${params.protocolId}'`);
        }
        // 3. Snapshot link state at decision time
        const linkState = await this.deps.emulator.getState();
        const nowMs = this.deps.clock.nowMs();
        const decisionId = randomUUID();
        // 4. Create decision log
        const doc = await AutonomousDecisionLog.create({
            decision_id: decisionId,
            protocol_id: params.protocolId,
            step_id: params.stepId,
            emergency_id: params.emergencyId ?? null,
            actor_id: params.actorId,
            actor_role: params.actorRole,
            action_taken: params.actionTaken,
            notes: params.notes ?? '',
            crew_id: params.crewId ?? null,
            vital_signs_snapshot: params.vitalSignsSnapshot ?? {},
            link_state_at_decision: {
                in_blackout: linkState.inBlackout,
                effective_delay_ms: linkState.effectiveDelayMs,
            },
            reconciled: false,
            created_at: new Date(nowMs),
        });
        // 5. Enqueue into DTN store-and-forward queue for ground sync
        if (this.deps.dtnQueue) {
            await this.deps.dtnQueue.enqueue({
                message_id: randomUUID(),
                direction: 'downlink',
                sender_id: params.actorId,
                sender_role: params.actorRole,
                type: 'protocol_action',
                target_id: params.emergencyId ?? params.protocolId,
                payload: {
                    decision_id: decisionId,
                    protocol_id: params.protocolId,
                    step_id: params.stepId,
                    action_taken: params.actionTaken,
                    emergency_id: params.emergencyId ?? null,
                    crew_id: params.crewId ?? null,
                    vital_signs_snapshot: params.vitalSignsSnapshot ?? {},
                },
                idempotency_key: `dtn-step-${decisionId}`,
            });
        }
        // 6. Publish bus event
        if (this.deps.eventBus) {
            this.deps.eventBus.publish({
                topic: 'system.notice',
                subtopic: 'protocol.step_completed',
                audience: { level: 'all' },
                priority: 'high',
                payload: {
                    decision_id: decisionId,
                    protocol_id: params.protocolId,
                    step_id: params.stepId,
                    actor_id: params.actorId,
                    emergency_id: params.emergencyId ?? null,
                },
            });
        }
        return this.toDecisionItem(doc);
    }
    /**
     * Retrieves logged decisions with optional filtering.
     */
    async getDecisions(filter) {
        const query = {};
        if (filter?.reconciled !== undefined)
            query['reconciled'] = filter.reconciled;
        if (filter?.emergency_id)
            query['emergency_id'] = filter.emergency_id;
        if (filter?.crew_id)
            query['crew_id'] = filter.crew_id;
        const limit = Math.min(filter?.limit ?? 100, 500);
        const docs = await AutonomousDecisionLog.find(query).sort({ created_at: -1 }).limit(limit);
        return docs.map((d) => this.toDecisionItem(d));
    }
    /**
     * Reconciles decisions taken during blackout (Ground Flight Surgeon action).
     */
    async reconcileDecisions(params) {
        // Only flight_surgeon or admin can reconcile decisions
        if (params.actorRole !== 'flight_surgeon' && params.actorRole !== 'admin') {
            throw new ForbiddenError('Decision reconciliation requires Flight Surgeon or Administrator role');
        }
        if (!params.decisionIds || params.decisionIds.length === 0) {
            throw new AppError('VALIDATION_ERROR', 'At least one decision_id must be provided');
        }
        const now = new Date(this.deps.clock.nowMs());
        await AutonomousDecisionLog.updateMany({ decision_id: { $in: params.decisionIds } }, {
            $set: {
                reconciled: true,
                reconciled_at: now,
                reconciled_by: params.reconciledBy,
                reconciliation_status: params.status,
                reconciliation_notes: params.reviewNotes,
            },
        });
        const updated = await AutonomousDecisionLog.find({
            decision_id: { $in: params.decisionIds },
        });
        if (this.deps.eventBus) {
            this.deps.eventBus.publish({
                topic: 'system.notice',
                subtopic: 'protocol.decisions_reconciled',
                audience: { level: 'all' },
                priority: 'standard',
                payload: {
                    reconciled_count: updated.length,
                    reconciled_by: params.reconciledBy,
                    status: params.status,
                },
            });
        }
        return {
            reconciled_count: updated.length,
            decisions: updated.map((d) => this.toDecisionItem(d)),
        };
    }
    toDecisionItem(doc) {
        return {
            decision_id: doc.decision_id,
            protocol_id: doc.protocol_id,
            step_id: doc.step_id,
            emergency_id: doc.emergency_id ?? null,
            actor_id: doc.actor_id,
            actor_role: doc.actor_role,
            action_taken: doc.action_taken,
            notes: doc.notes,
            crew_id: doc.crew_id ?? null,
            vital_signs_snapshot: doc.vital_signs_snapshot,
            link_state_at_decision: doc.link_state_at_decision,
            reconciled: doc.reconciled,
            reconciled_at: doc.reconciled_at ? doc.reconciled_at.toISOString() : null,
            reconciled_by: doc.reconciled_by ?? null,
            reconciliation_status: doc.reconciliation_status ?? null,
            reconciliation_notes: doc.reconciliation_notes ?? null,
            created_at: doc.created_at.toISOString(),
        };
    }
}
