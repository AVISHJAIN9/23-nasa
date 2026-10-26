/**
 * Pure authorization check determining if a principal may receive an event.
 * Shared identically by Socket.IO (/live) and REST replay (GET /v1/events).
 */
export function canReceive(event, principal) {
    const { role, crewId } = principal;
    // Ground and admin staff may receive any event
    if (role === 'admin' || role === 'flight_surgeon' || role === 'mission_control') {
        return true;
    }
    // System events: delivered to all roles
    if (event.topic === 'system') {
        return true;
    }
    // Every emergency event is received by all astronauts regardless of crew
    if (event.topic === 'emergency' || event.type.startsWith('emergency.')) {
        return true;
    }
    // Astronauts receive events for their own linked crew profile
    if (role === 'astronaut') {
        if (!event.crew_id) {
            return true;
        }
        return Boolean(crewId && event.crew_id === crewId);
    }
    return false;
}
/**
 * Checks whether a principal possesses medical access privileges.
 * Medical access is granted to flight_surgeon, admin, or astronauts with the medical officer claim.
 */
export function hasMedicalAccess(principal) {
    return (principal.role === 'admin' ||
        principal.role === 'flight_surgeon' ||
        (principal.role === 'astronaut' && Boolean(principal.isMedicalOfficer)));
}
/**
 * Projects an InboxItemDTO (or detail object) according to the principal's medical access.
 * Non-medical viewers (mission_control, ordinary astronauts) have resolution_note,
 * snooze_reason, and timeline entry notes removed.
 */
export function projectInboxItemForRole(item, principal) {
    if (hasMedicalAccess(principal)) {
        return item;
    }
    const copy = { ...item };
    delete copy['resolution_note'];
    delete copy['snooze_reason'];
    if (Array.isArray(copy['timeline'])) {
        copy['timeline'] = copy['timeline'].map((entry) => {
            const entryCopy = { ...entry };
            delete entryCopy['note'];
            return entryCopy;
        });
    }
    return copy;
}
/**
 * Pure projection function that returns a copy of the event with its payload
 * redacted/trimmed according to the caller's role and privileges.
 */
export function projectForRole(event, principal) {
    const { role, userId, isMedicalOfficer } = principal;
    let payloadCopy = { ...event.payload };
    // Never include medical_history or profile fields
    delete payloadCopy['medical_history'];
    // Emergency free-text redaction:
    // "note" and free text are included only for:
    // - the declaring astronaut
    // - astronauts with the medical-officer claim
    // - flight_surgeon
    // - admin
    // mission_control and other non-declaring non-medical crew get the event without free text
    if (event.topic === 'emergency' || event.type.startsWith('emergency.')) {
        const isDeclaringUser = payloadCopy['declared_by'] === userId;
        const canViewFreeText = role === 'admin' || role === 'flight_surgeon' || isDeclaringUser || Boolean(isMedicalOfficer);
        if (!canViewFreeText) {
            delete payloadCopy['note'];
            delete payloadCopy['resolution_note'];
        }
    }
    // Inbox event redaction:
    if (event.type.startsWith('inbox.')) {
        payloadCopy = projectInboxItemForRole(payloadCopy, principal);
    }
    return {
        ...event,
        payload: payloadCopy,
    };
}
