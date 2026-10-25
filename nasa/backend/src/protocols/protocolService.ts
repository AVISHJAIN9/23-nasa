/**
 * @module protocolService
 * Onboard Medical Protocol Guidance and Autonomous Decision Service (Phase 4).
 *
 * Exposes medical checklists to the Crew Medical Officer (CMO) during comms delay/blackout,
 * records decisions with link telemetry snapshots, and reconciles decisions with Ground Flight Surgeons.
 */

import { randomUUID } from 'node:crypto';
import { type Clock } from '../core/clock.js';
import { type EventBus } from '../bus/eventBus.js';
import { NotFoundError, ForbiddenError, AppError } from '../core/errors.js';
import { type CommsDelayEmulator } from '../link/commsDelayEmulator.js';
import { type StoreAndForwardQueue } from '../link/storeAndForward.js';
import {
  AutonomousDecisionLog,
  type IAutonomousDecisionLog,
} from '../models/AutonomousDecisionLog.js';
import { PROTOCOL_CATALOG } from './protocolCatalog.js';
import { type ProtocolChecklist, type HazardType } from '../schemas/protocols.js';

export interface ProtocolServiceDeps {
  clock: Clock;
  emulator: CommsDelayEmulator;
  dtnQueue?: StoreAndForwardQueue;
  eventBus?: EventBus;
}

export interface CompleteStepParams {
  protocolId: string;
  stepId: string;
  emergencyId?: string | null;
  crewId?: string | null;
  actionTaken: string;
  notes?: string;
  vitalSignsSnapshot?: Record<string, unknown>;
  actorId: string;
  actorRole: string;
  isMedicalOfficer: boolean;
}

export interface ReconcileParams {
  decisionIds: string[];
  reviewNotes: string;
  status: 'accepted' | 'amended' | 'flagged';
  reconciledBy: string;
  actorRole: string;
}

export class ProtocolService {
  constructor(private readonly deps: ProtocolServiceDeps) {}

  /**
   * Evaluates if autonomous mode is currently active:
   * link is in blackout OR one-way delay is severe (> 10 seconds).
   */
  public async isAutonomousModeActive(): Promise<boolean> {
    const state = await this.deps.emulator.getState();
    return state.inBlackout || state.effectiveDelayMs > 10_000;
  }

  /**
   * Lists available clinical protocols with optional hazard filter.
   */
  public async getProtocols(hazardType?: HazardType): Promise<{
    autonomous_mode_active: boolean;
    link_state: {
      in_blackout: boolean;
      effective_delay_ms: number;
    };
    protocols: ProtocolChecklist[];
  }> {
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
  public async getProtocolById(protocolId: string): Promise<{
    autonomous_mode_active: boolean;
    protocol: ProtocolChecklist;
  }> {
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
  public async completeStep(params: CompleteStepParams): Promise<Record<string, unknown>> {
    // 1. Role validation: Must be Crew Medical Officer or Flight Surgeon or Admin
    const canPrescribe =
      params.isMedicalOfficer ||
      params.actorRole === 'flight_surgeon' ||
      params.actorRole === 'admin';

    if (!canPrescribe) {
      throw new ForbiddenError(
        'Autonomous clinical interventions require Crew Medical Officer (CMO) or Flight Surgeon authorization',
      );
    }

    // 2. Validate protocol and step
    const protocol = PROTOCOL_CATALOG.find((p) => p.protocol_id === params.protocolId);
    if (!protocol) {
      throw new NotFoundError(`Protocol '${params.protocolId}' not found`);
    }

    const step = protocol.steps.find((s) => s.step_id === params.stepId);
    if (!step) {
      throw new NotFoundError(
        `Step '${params.stepId}' not found in protocol '${params.protocolId}'`,
      );
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
  public async getDecisions(filter?: {
    reconciled?: boolean;
    emergency_id?: string;
    crew_id?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    const query: Record<string, unknown> = {};
    if (filter?.reconciled !== undefined) query['reconciled'] = filter.reconciled;
    if (filter?.emergency_id) query['emergency_id'] = filter.emergency_id;
    if (filter?.crew_id) query['crew_id'] = filter.crew_id;

    const limit = Math.min(filter?.limit ?? 100, 500);
    const docs = await AutonomousDecisionLog.find(query).sort({ created_at: -1 }).limit(limit);

    return docs.map((d) => this.toDecisionItem(d));
  }

  /**
   * Reconciles decisions taken during blackout (Ground Flight Surgeon action).
   */
  public async reconcileDecisions(params: ReconcileParams): Promise<{
    reconciled_count: number;
    decisions: Record<string, unknown>[];
  }> {
    // Only flight_surgeon or admin can reconcile decisions
    if (params.actorRole !== 'flight_surgeon' && params.actorRole !== 'admin') {
      throw new ForbiddenError(
        'Decision reconciliation requires Flight Surgeon or Administrator role',
      );
    }

    if (!params.decisionIds || params.decisionIds.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'At least one decision_id must be provided');
    }

    const now = new Date(this.deps.clock.nowMs());

    await AutonomousDecisionLog.updateMany(
      { decision_id: { $in: params.decisionIds } },
      {
        $set: {
          reconciled: true,
          reconciled_at: now,
          reconciled_by: params.reconciledBy,
          reconciliation_status: params.status,
          reconciliation_notes: params.reviewNotes,
        },
      },
    );

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

  private toDecisionItem(doc: IAutonomousDecisionLog): Record<string, unknown> {
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
