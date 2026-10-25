import { describe, it, expect } from 'vitest';
import {
  applyAcknowledge,
  applyAssign,
  applySnooze,
  applyUnsnooze,
  applyResolve,
  applyNote,
  applySnoozeExpired,
  type WorkflowActor,
} from '../src/fusion/workflow.js';
import { type FusedAlertState } from '../src/fusion/fusionCore.js';
import { ConflictError, ValidationError } from '../src/core/errors.js';

describe('Workflow State Machine Pure Logic (F097)', () => {
  const actorSurgeon: WorkflowActor = {
    userId: 'user-surgeon-1',
    role: 'flight_surgeon',
  };

  const actorAstronaut: WorkflowActor = {
    userId: 'user-astro-1',
    role: 'astronaut',
  };

  const now = '2026-10-18T10:00:00.000Z';
  const limits = { maxWarningMin: 60, maxWatchMin: 480 };

  function makeMockAlert(overrides: Partial<FusedAlertState> = {}): FusedAlertState {
    return {
      crew_id: 'crew-01',
      hazard: 'respiratory',
      group_key: 'crew-01:respiratory',
      is_unresolved: true,
      status: 'open',
      condition: 'active',
      severity: 'warning',
      peak_severity: 'warning',
      priority_score: 40,
      priority_key: 3040,
      title: 'Respiratory: SpO2 low',
      summary: '1 source reporting',
      explanation: 'Oxygen low',
      factors: [],
      confidence: null,
      sources: ['rule'],
      metrics: ['spo2'],
      members: [],
      member_count_total: 1,
      dropped_members: 0,
      mission_mode: 'mars',
      raised_at: now,
      last_activity_at: now,
      suppressed_events: 0,
      reopen_count: 0,
      version: 1,
      timeline: [],
      ...overrides,
    };
  }

  describe('Acknowledge Action', () => {
    it('transitions open -> acknowledged, sets severity_at_ack and records user in acknowledged_by', () => {
      const alert = makeMockAlert({ status: 'open', severity: 'warning' });
      const { state, changed } = applyAcknowledge(alert, actorSurgeon, now);

      expect(changed).toBe(true);
      expect(state.status).toBe('acknowledged');
      expect(state.severity_at_ack).toBe('warning');
      expect(state.acknowledged_at).toBe(now);
      expect(state.acknowledged_by).toHaveLength(1);
      expect(state.acknowledged_by?.[0]?.user_id).toBe(actorSurgeon.userId);
      expect(state.version).toBe(2);
      expect(state.timeline.some((t) => t.type === 'acknowledged')).toBe(true);
    });

    it('cancels snooze when acknowledging a snoozed alert', () => {
      const alert = makeMockAlert({
        status: 'snoozed',
        snoozed_until: '2026-10-18T11:00:00.000Z',
        snooze_reason: 'Waiting for rest cycle',
      });

      const { state } = applyAcknowledge(alert, actorSurgeon, now);
      expect(state.status).toBe('acknowledged');
      expect(state.snoozed_until).toBeUndefined();
      expect(state.snooze_reason).toBeUndefined();
    });

    it('is idempotent when the same user acknowledges again, and appends second user', () => {
      const alert = makeMockAlert({ status: 'open' });
      const res1 = applyAcknowledge(alert, actorSurgeon, now);

      // Same user again: no-op, changed = false
      const res2 = applyAcknowledge(res1.state, actorSurgeon, now);
      expect(res2.changed).toBe(false);
      expect(res2.state.acknowledged_by).toHaveLength(1);

      // Second user acknowledges: succeeds, appends user, version increments
      const res3 = applyAcknowledge(res1.state, actorAstronaut, now);
      expect(res3.changed).toBe(true);
      expect(res3.state.acknowledged_by).toHaveLength(2);
      expect(res3.state.status).toBe('acknowledged');
    });

    it('resolves immediately when acknowledging an alert whose condition is already cleared', () => {
      const alert = makeMockAlert({ status: 'open', condition: 'cleared' });
      const { state, changed } = applyAcknowledge(
        alert,
        actorSurgeon,
        now,
        'Patient confirmed stable',
      );

      expect(changed).toBe(true);
      expect(state.status).toBe('resolved');
      expect(state.resolution).toBe('condition_cleared');
      expect(state.resolved_by).toBe(actorSurgeon.userId);
      expect(state.is_unresolved).toBe(false);
    });

    it('throws ConflictError when acknowledging an already resolved alert', () => {
      const alert = makeMockAlert({ status: 'resolved' });
      expect(() => applyAcknowledge(alert, actorSurgeon, now)).toThrowError(ConflictError);
    });
  });

  describe('Assign Action', () => {
    it('assigns user in open, acknowledged, or snoozed without changing status', () => {
      const alert = makeMockAlert({ status: 'open' });
      const { state, changed } = applyAssign(alert, actorSurgeon, 'user-surgeon-2', now);

      expect(changed).toBe(true);
      expect(state.assignee_id).toBe('user-surgeon-2');
      expect(state.assigned_by).toBe(actorSurgeon.userId);
      expect(state.status).toBe('open');

      // Unassigning (null)
      const unassign = applyAssign(state, actorSurgeon, null, now);
      expect(unassign.state.assignee_id).toBeNull();
      expect(unassign.changed).toBe(true);
    });

    it('throws ConflictError when assigning a resolved alert', () => {
      const alert = makeMockAlert({ status: 'resolved' });
      expect(() => applyAssign(alert, actorSurgeon, 'user-2', now)).toThrowError(ConflictError);
    });
  });

  describe('Snooze Action', () => {
    it('snoozes watch alert up to maxWatchMin (480)', () => {
      const alert = makeMockAlert({ status: 'open', severity: 'watch' });
      const { state } = applySnooze(
        alert,
        actorSurgeon,
        120,
        'Evaluating telemetry trend',
        now,
        limits,
      );

      expect(state.status).toBe('snoozed');
      expect(state.snoozed_by).toBe(actorSurgeon.userId);
      expect(state.snooze_reason).toBe('Evaluating telemetry trend');
      expect(state.snoozed_until).toBe('2026-10-18T12:00:00.000Z');
    });

    it('rejects critical alert snooze with ConflictError', () => {
      const alert = makeMockAlert({ status: 'open', severity: 'critical' });
      expect(() =>
        applySnooze(alert, actorSurgeon, 10, 'Cannot snooze critical', now, limits),
      ).toThrowError(ConflictError);
    });

    it('rejects snooze exceeding severity limits with ValidationError', () => {
      const alertWarning = makeMockAlert({ status: 'open', severity: 'warning' });
      // warning max is 60 min
      expect(() =>
        applySnooze(alertWarning, actorSurgeon, 61, 'Exceeding warning snooze', now, limits),
      ).toThrowError(ValidationError);

      const alertWatch = makeMockAlert({ status: 'open', severity: 'watch' });
      // watch max is 480 min
      expect(() =>
        applySnooze(alertWatch, actorSurgeon, 481, 'Exceeding watch snooze', now, limits),
      ).toThrowError(ValidationError);
    });

    it('rejects invalid duration or missing reason with ValidationError', () => {
      const alert = makeMockAlert({ status: 'open', severity: 'warning' });
      expect(() => applySnooze(alert, actorSurgeon, 0, 'Zero duration', now, limits)).toThrowError(
        ValidationError,
      );
      expect(() => applySnooze(alert, actorSurgeon, 30, 'no', now, limits)).toThrowError(
        ValidationError,
      );
    });

    it('unsnooze returns alert to open', () => {
      const alert = makeMockAlert({ status: 'snoozed', snoozed_until: '2026-10-18T11:00:00Z' });
      const { state } = applyUnsnooze(alert, actorSurgeon, now);
      expect(state.status).toBe('open');
      expect(state.snoozed_until).toBeUndefined();
    });

    it('snooze_expired transitions to open', () => {
      const alert = makeMockAlert({ status: 'snoozed', snoozed_until: '2026-10-18T10:00:00Z' });
      const { state } = applySnoozeExpired(alert, now);
      expect(state.status).toBe('open');
      expect(state.timeline.some((t) => t.type === 'snooze_expired')).toBe(true);
    });
  });

  describe('Resolve Action', () => {
    it('requires resolution_note (>=10 chars) when condition is active (dismissal)', () => {
      const alert = makeMockAlert({ status: 'open', condition: 'active', severity: 'warning' });

      // Missing or short note -> ValidationError
      expect(() => applyResolve(alert, actorSurgeon, now, 3600, 'short')).toThrowError(
        ValidationError,
      );

      // Valid note -> resolved, marked dismissed, suppress_until set
      const { state } = applyResolve(
        alert,
        actorSurgeon,
        now,
        3600,
        'Investigated and verified sensor artifact during exercise',
      );

      expect(state.status).toBe('resolved');
      expect(state.resolution).toBe('dismissed');
      expect(state.dismissed_severity).toBe('warning');
      expect(state.suppress_until).toBe('2026-10-18T11:00:00.000Z');
      expect(state.is_unresolved).toBe(false);
    });

    it('allows resolving without note when condition is cleared (manual resolution)', () => {
      const alert = makeMockAlert({ status: 'open', condition: 'cleared' });
      const { state } = applyResolve(alert, actorSurgeon, now, 3600);

      expect(state.status).toBe('resolved');
      expect(state.resolution).toBe('manual');
      expect(state.suppress_until).toBeUndefined();
    });

    it('throws ConflictError when resolving an already resolved alert', () => {
      const alert = makeMockAlert({ status: 'resolved' });
      expect(() => applyResolve(alert, actorSurgeon, now, 3600, 'Another note here')).toThrowError(
        ConflictError,
      );
    });
  });

  describe('Notes Action', () => {
    it('adds free-text note in any status including resolved', () => {
      const alert = makeMockAlert({ status: 'resolved' });
      const { state } = applyNote(alert, actorSurgeon, 'Follow-up clinical debrief complete', now);

      expect(
        state.timeline.some(
          (t) => t.type === 'note' && t.note === 'Follow-up clinical debrief complete',
        ),
      ).toBe(true);
      expect(state.version).toBe(2);
    });

    it('rejects empty or oversize notes with ValidationError', () => {
      const alert = makeMockAlert({ status: 'open' });
      expect(() => applyNote(alert, actorSurgeon, '', now)).toThrowError(ValidationError);
      expect(() => applyNote(alert, actorSurgeon, 'a'.repeat(1001), now)).toThrowError(
        ValidationError,
      );
    });
  });
});
