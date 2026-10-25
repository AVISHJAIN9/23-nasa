import { type Role } from '../core/roles.js';
import { type EventOrigin } from './eventTypes.js';

/**
 * Maps a user role to its operational origin on the communication link.
 * - flight_surgeon and mission_control are Earth-based -> 'ground'
 * - astronaut and admin are spacecraft-based -> 'onboard'
 */
export function originForRole(role: Role): EventOrigin {
  if (role === 'flight_surgeon' || role === 'mission_control') {
    return 'ground';
  }
  return 'onboard';
}
