import { type EmergencyStatus, type IAcknowledgedBy } from '../models/Emergency.js';
import { ConflictError } from '../core/errors.js';

export interface EmergencyState {
  status: EmergencyStatus;
  acknowledged_by: IAcknowledgedBy[];
  resolved_at?: Date | null;
  resolved_by?: string | null;
  resolution_note?: string | null;
  cancelled_at?: Date | null;
  cancelled_by?: string | null;
}

export type EmergencyAction =
  | { type: 'ACKNOWLEDGE'; userId: string; at?: Date }
  | { type: 'RESOLVE'; userId: string; resolutionNote?: string | null; at?: Date }
  | { type: 'CANCEL'; userId: string; at?: Date };

/**
 * Pure transition function for the Emergency state machine.
 * Throws ConflictError for any invalid transition.
 */
export function transitionEmergency(
  currentState: EmergencyState,
  action: EmergencyAction,
): EmergencyState {
  const at = action.at ?? new Date();

  switch (action.type) {
    case 'ACKNOWLEDGE': {
      if (currentState.status === 'resolved' || currentState.status === 'cancelled') {
        throw new ConflictError(
          `Cannot acknowledge emergency: current status is '${currentState.status}'`,
        );
      }

      const existingAck = currentState.acknowledged_by.some((ack) => ack.user_id === action.userId);

      const nextAcknowledgedBy = existingAck
        ? [...currentState.acknowledged_by]
        : [...currentState.acknowledged_by, { user_id: action.userId, at }];

      return {
        ...currentState,
        status: 'acknowledged',
        acknowledged_by: nextAcknowledgedBy,
      };
    }

    case 'RESOLVE': {
      if (currentState.status === 'resolved' || currentState.status === 'cancelled') {
        throw new ConflictError(
          `Cannot resolve emergency: current status is '${currentState.status}'`,
        );
      }

      return {
        ...currentState,
        status: 'resolved',
        resolved_at: at,
        resolved_by: action.userId,
        resolution_note: action.resolutionNote ?? null,
      };
    }

    case 'CANCEL': {
      if (currentState.status === 'resolved' || currentState.status === 'cancelled') {
        throw new ConflictError(
          `Cannot cancel emergency: current status is '${currentState.status}'`,
        );
      }

      return {
        ...currentState,
        status: 'cancelled',
        cancelled_at: at,
        cancelled_by: action.userId,
      };
    }

    default: {
      throw new ConflictError('Unknown emergency transition action');
    }
  }
}
