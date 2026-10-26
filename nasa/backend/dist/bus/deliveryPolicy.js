/**
 * Default zero-delay policy.
 */
export class NoDelayPolicy {
    deliverAfterMs(_event, _role) {
        return 0;
    }
}
