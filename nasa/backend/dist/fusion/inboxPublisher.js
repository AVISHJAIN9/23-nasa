import { logger } from '../core/logger.js';
import { defaultMetricsRegistry } from '../core/metrics.js';
/**
 * Transforms an IFusedAlert document into InboxItemDTO (list or detail format).
 */
export function toInboxItemDTO(alert, detail = false) {
    const base = {
        id: alert._id?.toString() || alert.id || '',
        crew_id: alert.crew_id,
        hazard: alert.hazard,
        status: alert.status,
        condition: alert.condition,
        severity: alert.severity,
        peak_severity: alert.peak_severity,
        priority_score: alert.priority_score,
        priority_key: alert.priority_key,
        title: alert.title,
        summary: alert.summary,
        sources: alert.sources,
        metrics: alert.metrics,
        member_count: alert.members?.length ?? 0,
        confidence: alert.confidence,
        assignee_id: alert.assignee_id,
        acknowledged_by: alert.acknowledged_by,
        acknowledged_at: alert.acknowledged_at,
        snoozed_until: alert.snoozed_until,
        raised_at: alert.raised_at,
        last_activity_at: alert.last_activity_at,
        version: alert.version,
        mission_mode: alert.mission_mode,
    };
    if (!detail) {
        return base;
    }
    return {
        ...base,
        members: alert.members,
        factors: alert.factors,
        explanation: alert.explanation,
        timeline: alert.timeline,
        resolution: alert.resolution,
        resolution_note: alert.resolution_note,
        snooze_reason: alert.snooze_reason,
        snoozed_by: alert.snoozed_by,
        reopen_count: alert.reopen_count,
        cleared_at: alert.cleared_at,
        resolved_at: alert.resolved_at,
        resolved_by: alert.resolved_by,
    };
}
/**
 * Publishes fused alert events to the central EventBus.
 * Contract: Never throws; logs and reports 'degraded' if publishing fails.
 */
export class InboxPublisher {
    eventBus;
    constructor(eventBus) {
        this.eventBus = eventBus;
    }
    async publishInboxEvent(eventType, alert, requestId, origin = 'onboard') {
        const payload = toInboxItemDTO(alert, true);
        // Map severity to event severity ('watch' -> 'info')
        const eventSeverity = alert.severity === 'critical'
            ? 'critical'
            : alert.severity === 'warning'
                ? 'warning'
                : 'info';
        if (eventType === 'inbox.raised') {
            defaultMetricsRegistry.recordAlertRaised(alert.hazard, alert.severity);
        }
        try {
            const envelope = await this.eventBus.publish({
                topic: 'alerts',
                type: eventType,
                crew_id: alert.crew_id,
                severity: eventSeverity,
                audience: 'all',
                origin,
                mission_mode: alert.mission_mode,
                request_id: requestId,
                payload: payload,
            });
            return {
                uid: envelope.uid,
                id: envelope.id,
                bus: 'ok',
            };
        }
        catch (err) {
            logger.error({ err, eventType, alertId: alert._id?.toString(), groupKey: alert.group_key }, 'Failed to publish inbox event to EventBus (degraded)');
            return {
                uid: '',
                id: null,
                bus: 'degraded',
            };
        }
    }
}
