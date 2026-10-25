import { type FusedAlertState, type FusedTimelineEntry } from './fusionCore.js';
import { ATTENTION_WEIGHTS } from './fusionConfig.js';
import { ConflictError, ValidationError } from '../core/errors.js';

export interface WorkflowActor {
  userId: string;
  role: string;
  isMedicalOfficer?: boolean;
}

/**
 * Validates and applies human ACKNOWLEDGE action.
 * Transitions:
 * - open -> acknowledged (or -> resolved if condition is already cleared!)
 * - snoozed -> acknowledged (cancels snooze)
 * - acknowledged -> acknowledged (idempotent; records user in acknowledged_by)
 * - resolved -> throws ConflictError
 */
export function applyAcknowledge(
  alert: FusedAlertState,
  actor: WorkflowActor,
  nowIso: string,
  note?: string,
): { state: FusedAlertState; changed: boolean } {
  if (alert.status === 'resolved') {
    throw new ConflictError(`Cannot acknowledge alert with status "resolved"`, {
      current_status: alert.status,
      id: alert.group_key,
    });
  }

  const existingAck = alert.acknowledged_by ?? [];
  const alreadyAckedByUser = existingAck.some((a) => a.user_id === actor.userId);

  // If already acknowledged and this user already acknowledged, it's a no-op idempotency
  if (alert.status === 'acknowledged' && alreadyAckedByUser && !note) {
    return { state: alert, changed: false };
  }

  const updatedAckBy = alreadyAckedByUser
    ? existingAck
    : [...existingAck, { user_id: actor.userId, at: nowIso }];

  // Special rule 6: Acknowledging an open+cleared alert resolves it immediately
  if (alert.condition === 'cleared') {
    const timeline: FusedTimelineEntry[] = [
      ...alert.timeline,
      {
        at: nowIso,
        type: 'acknowledged',
        actor_id: actor.userId,
        actor_role: actor.role,
        from_status: alert.status,
        to_status: 'resolved',
        note,
      },
      {
        at: nowIso,
        type: 'resolved',
        actor_id: actor.userId,
        actor_role: actor.role,
        from_status: 'acknowledged',
        to_status: 'resolved',
        note: 'condition_cleared',
      },
    ];

    const state: FusedAlertState = {
      ...alert,
      status: 'resolved',
      is_unresolved: false,
      severity_at_ack: alert.severity,
      acknowledged_at: alert.acknowledged_at ?? nowIso,
      acknowledged_by: updatedAckBy,
      resolved_at: nowIso,
      resolved_by: actor.userId,
      resolution: 'condition_cleared',
      resolution_note: note,
      last_activity_at: nowIso,
      version: alert.version + 1,
      priority_key: ATTENTION_WEIGHTS['resolved'] * 1000 + alert.priority_score,
      timeline,
    };
    return { state, changed: true };
  }

  // Normal acknowledge
  const fromStatus = alert.status;
  const toStatus = 'acknowledged';

  const timeline: FusedTimelineEntry[] = [
    ...alert.timeline,
    {
      at: nowIso,
      type: 'acknowledged',
      actor_id: actor.userId,
      actor_role: actor.role,
      from_status: fromStatus,
      to_status: toStatus,
      severity: alert.severity,
      note,
    },
  ];

  const state: FusedAlertState = {
    ...alert,
    status: 'acknowledged',
    is_unresolved: true,
    severity_at_ack: alert.severity,
    acknowledged_at: alert.acknowledged_at ?? nowIso,
    acknowledged_by: updatedAckBy,
    // clear snooze fields if transitioning from snoozed
    snoozed_until: undefined,
    snoozed_by: undefined,
    snooze_reason: undefined,
    last_activity_at: nowIso,
    version: alert.version + 1,
    priority_key: ATTENTION_WEIGHTS['acknowledged'] * 1000 + alert.priority_score,
    timeline,
  };

  return { state, changed: true };
}

/**
 * Validates and applies ASSIGN action.
 * Allowed in: open, acknowledged, snoozed.
 * Assignee must be active user with flight_surgeon/admin or medical_officer astronaut.
 */
export function applyAssign(
  alert: FusedAlertState,
  actor: WorkflowActor,
  assigneeId: string | null,
  nowIso: string,
): { state: FusedAlertState; changed: boolean } {
  if (alert.status === 'resolved') {
    throw new ConflictError(`Cannot assign alert with status "resolved"`, {
      current_status: alert.status,
    });
  }

  if (alert.assignee_id === assigneeId) {
    return { state: alert, changed: false };
  }

  const timeline: FusedTimelineEntry[] = [
    ...alert.timeline,
    {
      at: nowIso,
      type: 'assigned',
      actor_id: actor.userId,
      actor_role: actor.role,
      from_status: alert.status,
      to_status: alert.status,
      ref_id: assigneeId ?? undefined,
      note: assigneeId ? `Assigned to ${assigneeId}` : 'Unassigned',
    },
  ];

  const state: FusedAlertState = {
    ...alert,
    assignee_id: assigneeId,
    assigned_at: assigneeId ? nowIso : undefined,
    assigned_by: assigneeId ? actor.userId : undefined,
    last_activity_at: nowIso,
    version: alert.version + 1,
    timeline,
  };

  return { state, changed: true };
}

/**
 * Validates and applies SNOOZE action.
 * Allowed in: open, acknowledged.
 * Limits:
 * - severity "critical" cannot be snoozed (CONFLICT)
 * - warning max ASTRO_FUSION_SNOOZE_MAX_WARNING_MIN (VALIDATION_ERROR)
 * - watch max ASTRO_FUSION_SNOOZE_MAX_WATCH_MIN (VALIDATION_ERROR)
 */
export function applySnooze(
  alert: FusedAlertState,
  actor: WorkflowActor,
  durationMin: number,
  reason: string,
  nowIso: string,
  limits: { maxWarningMin: number; maxWatchMin: number },
): { state: FusedAlertState } {
  if (alert.status === 'resolved') {
    throw new ConflictError(`Cannot snooze alert with status "resolved"`, {
      current_status: alert.status,
    });
  }

  if (alert.severity === 'critical') {
    throw new ConflictError(
      'Critical alerts cannot be snoozed due to space-flight medical safety protocol',
      { severity: alert.severity },
    );
  }

  if (!reason || reason.trim().length < 3 || reason.trim().length > 200) {
    throw new ValidationError('Snooze reason must be between 3 and 200 characters', [
      { field: 'reason', issue: 'Must be between 3 and 200 characters' },
    ]);
  }

  if (durationMin <= 0) {
    throw new ValidationError('Snooze duration must be greater than 0 minutes', [
      { field: 'duration_min', issue: 'Must be > 0' },
    ]);
  }

  if (alert.severity === 'warning' && durationMin > limits.maxWarningMin) {
    throw new ValidationError(
      `Snooze duration for warning alerts cannot exceed ${limits.maxWarningMin} minutes`,
      [{ field: 'duration_min', issue: `Max allowed for warning is ${limits.maxWarningMin} min` }],
    );
  }

  if (alert.severity === 'watch' && durationMin > limits.maxWatchMin) {
    throw new ValidationError(
      `Snooze duration for watch alerts cannot exceed ${limits.maxWatchMin} minutes`,
      [{ field: 'duration_min', issue: `Max allowed for watch is ${limits.maxWatchMin} min` }],
    );
  }

  const snoozedUntil = new Date(new Date(nowIso).getTime() + durationMin * 60 * 1000).toISOString();

  const timeline: FusedTimelineEntry[] = [
    ...alert.timeline,
    {
      at: nowIso,
      type: 'snoozed',
      actor_id: actor.userId,
      actor_role: actor.role,
      from_status: alert.status,
      to_status: 'snoozed',
      note: reason.trim(),
    },
  ];

  const state: FusedAlertState = {
    ...alert,
    status: 'snoozed',
    is_unresolved: true,
    snoozed_until: snoozedUntil,
    snoozed_by: actor.userId,
    snooze_reason: reason.trim(),
    last_activity_at: nowIso,
    version: alert.version + 1,
    priority_key: ATTENTION_WEIGHTS['snoozed'] * 1000 + alert.priority_score,
    timeline,
  };

  return { state };
}

/**
 * Validates and applies UNSNOOZE action.
 * Allowed in: snoozed -> transitions to open.
 */
export function applyUnsnooze(
  alert: FusedAlertState,
  actor: WorkflowActor,
  nowIso: string,
): { state: FusedAlertState } {
  if (alert.status !== 'snoozed') {
    throw new ConflictError(
      `Cannot unsnooze alert with status "${alert.status}". Only snoozed alerts can be unsnoozed.`,
      { current_status: alert.status },
    );
  }

  const timeline: FusedTimelineEntry[] = [
    ...alert.timeline,
    {
      at: nowIso,
      type: 'unsnoozed',
      actor_id: actor.userId,
      actor_role: actor.role,
      from_status: 'snoozed',
      to_status: 'open',
    },
  ];

  const state: FusedAlertState = {
    ...alert,
    status: 'open',
    is_unresolved: true,
    snoozed_until: undefined,
    snoozed_by: undefined,
    snooze_reason: undefined,
    last_activity_at: nowIso,
    version: alert.version + 1,
    priority_key: ATTENTION_WEIGHTS['open'] * 1000 + alert.priority_score,
    timeline,
  };

  return { state };
}

/**
 * Sweeper transition: snooze expired -> returns to open.
 */
export function applySnoozeExpired(
  alert: FusedAlertState,
  nowIso: string,
): { state: FusedAlertState } {
  if (alert.status !== 'snoozed') {
    return { state: alert };
  }

  const timeline: FusedTimelineEntry[] = [
    ...alert.timeline,
    {
      at: nowIso,
      type: 'snooze_expired',
      actor_id: 'system',
      actor_role: 'system',
      from_status: 'snoozed',
      to_status: 'open',
    },
  ];

  const state: FusedAlertState = {
    ...alert,
    status: 'open',
    is_unresolved: true,
    snoozed_until: undefined,
    snoozed_by: undefined,
    snooze_reason: undefined,
    last_activity_at: nowIso,
    version: alert.version + 1,
    priority_key: ATTENTION_WEIGHTS['open'] * 1000 + alert.priority_score,
    timeline,
  };

  return { state };
}

/**
 * Validates and applies RESOLVE action.
 * Allowed in: open, acknowledged, snoozed.
 * If condition is "active", resolution_note is required (>= 10 chars) and alert is marked dismissed.
 * If condition is "cleared", resolution_note is optional.
 */
export function applyResolve(
  alert: FusedAlertState,
  actor: WorkflowActor,
  nowIso: string,
  dismissSuppressS: number,
  resolutionNote?: string,
): { state: FusedAlertState } {
  if (alert.status === 'resolved') {
    throw new ConflictError(`Cannot resolve alert that is already resolved`, {
      current_status: alert.status,
    });
  }

  const isConditionActive = alert.condition === 'active';

  if (isConditionActive) {
    if (!resolutionNote || resolutionNote.trim().length < 10) {
      throw new ValidationError(
        'Resolution note of at least 10 characters is required when resolving an active alert (dismissal)',
        [
          {
            field: 'resolution_note',
            issue: 'Must be at least 10 characters when condition is active',
          },
        ],
      );
    }
  }

  const resolution = isConditionActive ? 'dismissed' : 'manual';
  const suppressUntil = isConditionActive
    ? new Date(new Date(nowIso).getTime() + dismissSuppressS * 1000).toISOString()
    : undefined;

  const timeline: FusedTimelineEntry[] = [
    ...alert.timeline,
    {
      at: nowIso,
      type: 'resolved',
      actor_id: actor.userId,
      actor_role: actor.role,
      from_status: alert.status,
      to_status: 'resolved',
      note: resolutionNote?.trim() || resolution,
    },
  ];

  const state: FusedAlertState = {
    ...alert,
    status: 'resolved',
    is_unresolved: false,
    resolved_at: nowIso,
    resolved_by: actor.userId,
    resolution,
    resolution_note: resolutionNote?.trim(),
    dismissed_severity: isConditionActive ? alert.severity : undefined,
    suppress_until: suppressUntil,
    // clear snooze
    snoozed_until: undefined,
    snoozed_by: undefined,
    snooze_reason: undefined,
    last_activity_at: nowIso,
    version: alert.version + 1,
    priority_key: ATTENTION_WEIGHTS['resolved'] * 1000 + alert.priority_score,
    timeline,
  };

  return { state };
}

/**
 * Validates and applies NOTE addition.
 * Allowed in ANY status including resolved.
 */
export function applyNote(
  alert: FusedAlertState,
  actor: WorkflowActor,
  noteText: string,
  nowIso: string,
): { state: FusedAlertState } {
  if (!noteText || noteText.trim().length === 0 || noteText.length > 1000) {
    throw new ValidationError('Note must be between 1 and 1000 characters', [
      { field: 'text', issue: 'Length must be between 1 and 1000 characters' },
    ]);
  }

  const timeline: FusedTimelineEntry[] = [
    ...alert.timeline,
    {
      at: nowIso,
      type: 'note',
      actor_id: actor.userId,
      actor_role: actor.role,
      note: noteText.trim(),
    },
  ];

  const state: FusedAlertState = {
    ...alert,
    last_activity_at: nowIso,
    version: alert.version + 1,
    timeline,
  };

  return { state };
}
