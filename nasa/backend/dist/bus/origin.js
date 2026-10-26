/**
 * Maps a user role to its operational origin on the communication link.
 * - flight_surgeon and mission_control are Earth-based -> 'ground'
 * - astronaut and admin are spacecraft-based -> 'onboard'
 */
export function originForRole(role) {
    if (role === 'flight_surgeon' || role === 'mission_control') {
        return 'ground';
    }
    return 'onboard';
}
