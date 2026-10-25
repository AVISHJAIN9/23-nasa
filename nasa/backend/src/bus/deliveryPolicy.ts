import { type Envelope } from './eventTypes.js';
import { type Role } from '../core/roles.js';

/**
 * Hook for Part 2e Earth-to-spacecraft comms delay emulation.
 */
export interface DeliveryPolicy {
  /**
   * Returns how many milliseconds to delay delivery of this event to a client of this role.
   * A return value of 0 means deliver immediately.
   */
  deliverAfterMs(event: Envelope, role: Role): number;
}

/**
 * Default zero-delay policy.
 */
export class NoDelayPolicy implements DeliveryPolicy {
  public deliverAfterMs(_event: Envelope, _role: Role): number {
    return 0;
  }
}
