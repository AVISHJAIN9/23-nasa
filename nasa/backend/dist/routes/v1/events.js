import { Router } from 'express';
import { registerRoute } from '../../core/openapi.js';
import { authenticate } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import { NoDelayPolicy } from '../../bus/deliveryPolicy.js';
import { canReceive, projectForRole } from '../../bus/audience.js';
import { getCallerPrincipal } from './emergencies.js';
import { EventReplayQuerySchema, EventReplayResponseSchema, } from '../../schemas/events.js';
export function createV1EventsRouter(deps) {
    const router = Router();
    const bus = deps.eventBus;
    const policy = deps.deliveryPolicy ?? new NoDelayPolicy();
    registerRoute({
        method: 'get',
        path: '/v1/events',
        tags: ['Events'],
        summary: 'Replay historical events via REST (F118)',
        description: 'Fallback event replay endpoint for environments where WebSocket connections are unavailable. Replays stream events strictly after the provided stream ID.',
        request: {
            query: EventReplayQuerySchema,
        },
        successResponse: {
            status: 200,
            description: 'Replayed events with truncation and reset indicators',
            schema: EventReplayResponseSchema,
        },
    });
    router.get('/', authenticate, validate({ query: EventReplayQuerySchema }), async (req, res, next) => {
        try {
            const caller = await getCallerPrincipal(req);
            const query = (res.locals.validated?.query ?? req.query);
            const afterId = query.after ?? null;
            const limit = query.limit ?? 100;
            const replayResult = await bus.replay(afterId, {
                limit,
                filter: (e) => {
                    // 1. Audience authorization check
                    if (!canReceive(e, caller))
                        return false;
                    // 2. Query topic filter
                    if (query.topic && e.topic !== query.topic)
                        return false;
                    // 3. Query crew_id filter
                    if (query.crew_id && e.crew_id !== query.crew_id)
                        return false;
                    // 4. Delivery policy check (events whose delivery time has not been reached are excluded)
                    const delay = policy.deliverAfterMs(e, caller.role);
                    if (delay > 0) {
                        const emitTime = new Date(e.emitted_at).getTime();
                        if (Date.now() < emitTime + delay) {
                            return false;
                        }
                    }
                    return true;
                },
            });
            // Apply role projection to each returned event
            const projectedEvents = replayResult.events.map((e) => projectForRole(e, caller));
            res.status(200).json({
                events: projectedEvents,
                head_id: replayResult.head_id,
                truncated: replayResult.truncated,
                reset: replayResult.reset,
            });
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
