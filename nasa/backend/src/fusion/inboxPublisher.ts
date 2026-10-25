import { type EventBus } from '../bus/eventBus.js';
import { type IFusedAlert } from '../models/FusedAlert.js';
import { logger } from '../core/logger.js';
import { type EventSeverity, type MissionMode, type EventOrigin } from '../bus/eventTypes.js';

import { type InboxItemDTO } from '../schemas/inbox.js';
import { defaultMetricsRegistry } from '../core/metrics.js';
export { type InboxItemDTO };

/**
 * Transforms an IFusedAlert document into InboxItemDTO (list or detail format).
 */
export function toInboxItemDTO(alert: IFusedAlert, detail = false): InboxItemDTO {
  const base: InboxItemDTO = {
    id: alert._id?.toString() || (alert as unknown as { id?: string }).id || '',
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

export interface PublishResult {
  uid: string;
  id: string | null;
  bus: 'ok' | 'degraded';
}

/**
 * Publishes fused alert events to the central EventBus.
 * Contract: Never throws; logs and reports 'degraded' if publishing fails.
 */
export class InboxPublisher {
  constructor(private readonly eventBus: EventBus) {}

  public async publishInboxEvent(
    eventType: 'inbox.raised' | 'inbox.updated' | 'inbox.status_changed',
    alert: IFusedAlert,
    requestId?: string,
    origin: EventOrigin = 'onboard',
  ): Promise<PublishResult> {
    const payload = toInboxItemDTO(alert, true);

    // Map severity to event severity ('watch' -> 'info')
    const eventSeverity: EventSeverity =
      alert.severity === 'critical'
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
        mission_mode: alert.mission_mode as MissionMode,
        request_id: requestId,
        payload: payload as unknown as Record<string, unknown>,
      });

      return {
        uid: envelope.uid,
        id: envelope.id,
        bus: 'ok',
      };
    } catch (err) {
      logger.error(
        { err, eventType, alertId: alert._id?.toString(), groupKey: alert.group_key },
        'Failed to publish inbox event to EventBus (degraded)',
      );
      return {
        uid: '',
        id: null,
        bus: 'degraded',
      };
    }
  }
}
