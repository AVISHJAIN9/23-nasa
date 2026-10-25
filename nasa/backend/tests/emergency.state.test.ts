import { describe, it, expect } from 'vitest';
import { transitionEmergency, type EmergencyState } from '../src/emergency/stateMachine.js';
import { ConflictError } from '../src/core/errors.js';

describe('Emergency State Machine (F063)', () => {
  const initialState: EmergencyState = {
    status: 'active',
    acknowledged_by: [],
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
    cancelled_at: null,
    cancelled_by: null,
  };

  it('transitions from active to acknowledged upon first acknowledge', () => {
    const at = new Date('2026-10-18T10:00:00Z');
    const next = transitionEmergency(initialState, {
      type: 'ACKNOWLEDGE',
      userId: 'user-1',
      at,
    });

    expect(next.status).toBe('acknowledged');
    expect(next.acknowledged_by).toHaveLength(1);
    expect(next.acknowledged_by[0]).toEqual({ user_id: 'user-1', at });
  });

  it('appends another user to acknowledged_by, but is idempotent for the same user', () => {
    const at1 = new Date('2026-10-18T10:00:00Z');
    const state1 = transitionEmergency(initialState, {
      type: 'ACKNOWLEDGE',
      userId: 'user-1',
      at: at1,
    });

    const at2 = new Date('2026-10-18T10:01:00Z');
    const state2 = transitionEmergency(state1, {
      type: 'ACKNOWLEDGE',
      userId: 'user-2',
      at: at2,
    });

    expect(state2.status).toBe('acknowledged');
    expect(state2.acknowledged_by).toHaveLength(2);

    // Duplicate acknowledge by user-1 is a no-op on acknowledged_by
    const state3 = transitionEmergency(state2, {
      type: 'ACKNOWLEDGE',
      userId: 'user-1',
      at: new Date('2026-10-18T10:02:00Z'),
    });
    expect(state3.acknowledged_by).toHaveLength(2);
  });

  it('transitions from active or acknowledged to resolved', () => {
    const at = new Date('2026-10-18T10:05:00Z');
    const resolvedFromActive = transitionEmergency(initialState, {
      type: 'RESOLVE',
      userId: 'surgeon-1',
      resolutionNote: 'Patient stabilized',
      at,
    });

    expect(resolvedFromActive.status).toBe('resolved');
    expect(resolvedFromActive.resolved_by).toBe('surgeon-1');
    expect(resolvedFromActive.resolution_note).toBe('Patient stabilized');
    expect(resolvedFromActive.resolved_at).toEqual(at);

    const ackState = transitionEmergency(initialState, {
      type: 'ACKNOWLEDGE',
      userId: 'user-1',
    });
    const resolvedFromAck = transitionEmergency(ackState, {
      type: 'RESOLVE',
      userId: 'surgeon-1',
      resolutionNote: 'Stabilized',
    });
    expect(resolvedFromAck.status).toBe('resolved');
  });

  it('transitions from active or acknowledged to cancelled', () => {
    const at = new Date('2026-10-18T10:01:00Z');
    const cancelled = transitionEmergency(initialState, {
      type: 'CANCEL',
      userId: 'user-1',
      at,
    });

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelled_by).toBe('user-1');
    expect(cancelled.cancelled_at).toEqual(at);
  });

  it('rejects any transition on terminal states (resolved and cancelled) with ConflictError', () => {
    const resolvedState: EmergencyState = {
      ...initialState,
      status: 'resolved',
      resolved_at: new Date(),
      resolved_by: 'surgeon-1',
    };

    const cancelledState: EmergencyState = {
      ...initialState,
      status: 'cancelled',
      cancelled_at: new Date(),
      cancelled_by: 'user-1',
    };

    for (const state of [resolvedState, cancelledState]) {
      expect(() => transitionEmergency(state, { type: 'ACKNOWLEDGE', userId: 'user-2' })).toThrow(
        ConflictError,
      );

      expect(() =>
        transitionEmergency(state, {
          type: 'RESOLVE',
          userId: 'surgeon-1',
          resolutionNote: 'test',
        }),
      ).toThrow(ConflictError);

      expect(() => transitionEmergency(state, { type: 'CANCEL', userId: 'user-1' })).toThrow(
        ConflictError,
      );
    }
  });
});
