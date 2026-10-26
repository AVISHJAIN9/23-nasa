import { FusedAlert } from '../models/FusedAlert.js';
import { ConflictError, NotFoundError } from '../core/errors.js';
export class MongoFusionRepository {
    async findUnresolvedByGroupKey(groupKey) {
        return await FusedAlert.findOne({ group_key: groupKey, is_unresolved: true });
    }
    async findLatestDismissedByGroupKey(groupKey) {
        return await FusedAlert.findOne({
            group_key: groupKey,
            status: 'resolved',
            resolution: 'dismissed',
        }).sort({ resolved_at: -1, _id: -1 });
    }
    async findById(id) {
        return await FusedAlert.findById(id);
    }
    async saveNewAlert(state, latencyMs) {
        const doc = new FusedAlert({
            ...state,
            fusion_latency_ms: latencyMs,
        });
        return await doc.save();
    }
    async atomicUpdateAlert(id, state, expectedVersion, latencyMs) {
        const filter = { _id: id };
        if (expectedVersion !== undefined) {
            filter['version'] = expectedVersion;
        }
        const setFields = {
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
        const unsetFields = {};
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
        ];
        for (const field of optionalFields) {
            if (state[field] !== undefined) {
                setFields[field] = state[field];
            }
            else {
                unsetFields[field] = 1;
            }
        }
        const updateDoc = {
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
            throw new ConflictError(`Version mismatch on fused alert: expected ${expectedVersion}, current version is ${current.version}`, {
                current_version: current.version,
                expected_version: expectedVersion,
                current_status: current.status,
            });
        }
        return updated;
    }
    async atomicAcknowledge(id, actor, nowIso, note, expectedVersion) {
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
            throw new ConflictError(`Version mismatch on fused alert: expected ${expectedVersion}, current version is ${current.version}`, {
                current_version: current.version,
                expected_version: expectedVersion,
                current_status: current.status,
                current_severity: current.severity,
            });
        }
        const isResolved = current.condition === 'cleared';
        const filter = { _id: id };
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
        const setFields = {
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
        const updateDoc = {
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
            throw new ConflictError(`Version mismatch on fused alert: expected ${expectedVersion}, current version is ${latest.version}`, {
                current_version: latest.version,
                expected_version: expectedVersion,
                current_status: latest.status,
                current_severity: latest.severity,
            });
        }
        return updated;
    }
    async findExpiredSnoozes(nowIso) {
        return await FusedAlert.find({
            status: 'snoozed',
            snoozed_until: { $lte: nowIso },
        });
    }
    async incrementSuppressedCount(id) {
        await FusedAlert.findByIdAndUpdate(id, { $inc: { suppressed_events: 1 } });
    }
    async updateLastPublished(id, nowIso) {
        await FusedAlert.findByIdAndUpdate(id, { $set: { last_published_at: nowIso } });
    }
    async countUnresolved() {
        return await FusedAlert.countDocuments({ is_unresolved: true });
    }
    async countUnacknowledgedCritical() {
        return await FusedAlert.countDocuments({
            is_unresolved: true,
            status: 'open',
            severity: 'critical',
        });
    }
}
