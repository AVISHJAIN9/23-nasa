import { FusedAlert, type IFusedAlert } from '../models/FusedAlert.js';
import { type FusedAlertState } from './fusionCore.js';
import { ConflictError, NotFoundError } from '../core/errors.js';

export interface FusionRepository {
  findUnresolvedByGroupKey(groupKey: string): Promise<IFusedAlert | null>;
  findLatestDismissedByGroupKey(groupKey: string): Promise<IFusedAlert | null>;
  findById(id: string): Promise<IFusedAlert | null>;
  saveNewAlert(state: FusedAlertState, latencyMs?: number): Promise<IFusedAlert>;
  atomicUpdateAlert(
    id: string,
    state: FusedAlertState,
    expectedVersion?: number,
    latencyMs?: number,
  ): Promise<IFusedAlert>;
  atomicAcknowledge(
    id: string,
    actor: { userId: string; role: string },
    nowIso: string,
    note?: string,
    expectedVersion?: number,
  ): Promise<IFusedAlert>;
  findExpiredSnoozes(nowIso: string): Promise<IFusedAlert[]>;
  incrementSuppressedCount(id: string): Promise<void>;
  updateLastPublished(id: string, nowIso: string): Promise<void>;
  countUnresolved(): Promise<number>;
  countUnacknowledgedCritical(): Promise<number>;
}

export class MongoFusionRepository implements FusionRepository {
  public async findUnresolvedByGroupKey(groupKey: string): Promise<IFusedAlert | null> {
    return await FusedAlert.findOne({ group_key: groupKey, is_unresolved: true });
  }

  public async findLatestDismissedByGroupKey(groupKey: string): Promise<IFusedAlert | null> {
    return await FusedAlert.findOne({
      group_key: groupKey,
      status: 'resolved',
      resolution: 'dismissed',
    }).sort({ resolved_at: -1, _id: -1 });
  }

  public async findById(id: string): Promise<IFusedAlert | null> {
    return await FusedAlert.findById(id);
  }

  public async saveNewAlert(state: FusedAlertState, latencyMs?: number): Promise<IFusedAlert> {
    const doc = new FusedAlert({
      ...state,
      fusion_latency_ms: latencyMs,
    });
    return await doc.save();
  }

  public async atomicUpdateAlert(
    id: string,
    state: FusedAlertState,
    expectedVersion?: number,
    latencyMs?: number,
  ): Promise<IFusedAlert> {
    const filter: Record<string, unknown> = { _id: id };
    if (expectedVersion !== undefined) {
      filter['version'] = expectedVersion;
    }

    const setFields: Record<string, unknown> = {
      hazard: state.hazard,
      group_key: state.group_key,
      is_unresolved: state.is_unresolved,
      status: state.status,
      condition: state.condition,
      severity: state.severity,
      peak_severity: state.peak_severity,
      priority_score: state.priority_score,
      priority_key: state.priority_key,
      title: state.title,
      summary: state.summary,
      explanation: state.explanation,
      factors: state.factors,
      confidence: state.confidence,
      sources: state.sources,
      metrics: state.metrics,
      members: state.members,
      member_count_total: state.member_count_total,
      dropped_members: state.dropped_members,
      mission_mode: state.mission_mode,
      mission_day: state.mission_day,
      raised_at: state.raised_at,
      last_activity_at: state.last_activity_at,
      acknowledged_at: state.acknowledged_at,
      acknowledged_by: state.acknowledged_by,
      assignee_id: state.assignee_id,
      assigned_at: state.assigned_at,
      assigned_by: state.assigned_by,
      suppressed_events: state.suppressed_events,
      reopen_count: state.reopen_count,
      timeline: state.timeline,
      ...(latencyMs !== undefined ? { fusion_latency_ms: latencyMs } : {}),
    };

    const unsetFields: Record<string, 1> = {};

    const optionalFields = [
      'severity_at_ack',
      'snoozed_until',
      'snoozed_by',
      'snooze_reason',
      'cleared_at',
      'resolved_at',
      'resolved_by',
      'resolution',
      'resolution_note',
      'dismissed_severity',
      'suppress_until',
    ] as const;

    for (const field of optionalFields) {
      if (state[field] !== undefined) {
        setFields[field] = state[field];
      } else {
        unsetFields[field] = 1;
      }
    }

    const updateDoc: Record<string, unknown> = {
      $set: setFields,
      $inc: { version: 1 },
      ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
    };

    const updated = await FusedAlert.findOneAndUpdate(filter, updateDoc, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      const current = await FusedAlert.findById(id);
      if (!current) {
        throw new NotFoundError(`Fused alert with id "${id}" not found`);
      }
      throw new ConflictError(
        `Version mismatch on fused alert: expected ${expectedVersion}, current version is ${current.version}`,
        {
          current_version: current.version,
          expected_version: expectedVersion,
          current_status: current.status,
        },
      );
    }

    return updated;
  }

  public async atomicAcknowledge(
    id: string,
    actor: { userId: string; role: string },
    nowIso: string,
    note?: string,
    expectedVersion?: number,
  ): Promise<IFusedAlert> {
    const current = await FusedAlert.findById(id);
    if (!current) {
      throw new NotFoundError(`Fused alert with id "${id}" not found`);
    }

    if (current.status === 'resolved') {
      throw new ConflictError(`Cannot acknowledge alert with status "resolved"`, {
        current_status: current.status,
        id: current.group_key,
      });
    }

    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new ConflictError(
        `Version mismatch on fused alert: expected ${expectedVersion}, current version is ${current.version}`,
        {
          current_version: current.version,
          expected_version: expectedVersion,
          current_status: current.status,
          current_severity: current.severity,
        },
      );
    }

    const isResolved = current.condition === 'cleared';
    const filter: Record<string, unknown> = { _id: id };
    if (expectedVersion !== undefined) {
      filter['version'] = expectedVersion;
    }

    const timelineEntry = {
      at: nowIso,
      type: 'acknowledged',
      actor_id: actor.userId,
      actor_role: actor.role,
      from_status: current.status,
      to_status: isResolved ? 'resolved' : 'acknowledged',
      ...(note ? { note } : {}),
    };

    const setFields: Record<string, unknown> = {
      status: isResolved ? 'resolved' : 'acknowledged',
      is_unresolved: !isResolved,
      last_activity_at: nowIso,
    };
    if (!current.acknowledged_at) {
      setFields['acknowledged_at'] = nowIso;
    }
    if (!current.severity_at_ack) {
      setFields['severity_at_ack'] = current.severity;
    }
    if (isResolved) {
      setFields['resolved_at'] = nowIso;
      setFields['resolved_by'] = actor.userId;
      setFields['resolution'] = 'manual';
    }

    const updateDoc: Record<string, unknown> = {
      $set: setFields,
      $push: { timeline: timelineEntry },
      $inc: { version: 1 },
      $addToSet: {
        acknowledged_by: { user_id: actor.userId, at: nowIso },
      },
    };

    const updated = await FusedAlert.findOneAndUpdate(filter, updateDoc, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      const latest = await FusedAlert.findById(id);
      if (!latest) {
        throw new NotFoundError(`Fused alert with id "${id}" not found`);
      }
      throw new ConflictError(
        `Version mismatch on fused alert: expected ${expectedVersion}, current version is ${latest.version}`,
        {
          current_version: latest.version,
          expected_version: expectedVersion,
          current_status: latest.status,
          current_severity: latest.severity,
        },
      );
    }

    return updated;
  }

  public async findExpiredSnoozes(nowIso: string): Promise<IFusedAlert[]> {
    return await FusedAlert.find({
      status: 'snoozed',
      snoozed_until: { $lte: nowIso },
    });
  }

  public async incrementSuppressedCount(id: string): Promise<void> {
    await FusedAlert.findByIdAndUpdate(id, { $inc: { suppressed_events: 1 } });
  }

  public async updateLastPublished(id: string, nowIso: string): Promise<void> {
    await FusedAlert.findByIdAndUpdate(id, { $set: { last_published_at: nowIso } });
  }

  public async countUnresolved(): Promise<number> {
    return await FusedAlert.countDocuments({ is_unresolved: true });
  }

  public async countUnacknowledgedCritical(): Promise<number> {
    return await FusedAlert.countDocuments({
      is_unresolved: true,
      status: 'open',
      severity: 'critical',
    });
  }
}
