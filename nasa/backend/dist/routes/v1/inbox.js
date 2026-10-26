import { Router } from 'express';
import { z } from 'zod';
import { registerRoute } from '../../core/openapi.js';
import { authenticate } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import { getCallerPrincipal } from './emergencies.js';
import { InboxQuerySchema, InboxItemDTOSchema, InboxSummarySchema, ActionResponseSchema, AcknowledgeBodySchema, AssignBodySchema, SnoozeBodySchema, UnsnoozeBodySchema, ResolveBodySchema, AddNoteBodySchema, } from '../../schemas/inbox.js';
import { createPageSchema } from '../../schemas/common.js';
import { getRequestId } from '../../core/requestContext.js';
const ParamIdSchema = z.object({
    id: z.string().describe('24-character hexadecimal ObjectId'),
});
export function createV1InboxRouter(inboxService) {
    const router = Router();
    // All inbox endpoints require JWT authentication
    router.use(authenticate);
    // 1. GET /v1/inbox - List inbox items with keyset pagination
    registerRoute({
        method: 'get',
        path: '/v1/inbox',
        tags: ['Alerts', 'Inbox'],
        summary: 'List prioritized, de-duplicated fused alert inbox cards (F097)',
        description: 'Returns a paginated list of fused alert cards with keyset cursor pagination. Astronauts are scoped to their crew profile.',
        request: {
            query: InboxQuerySchema,
        },
        successResponse: {
            status: 200,
            description: 'Page of InboxItemDTO items',
            schema: createPageSchema(InboxItemDTOSchema),
        },
    });
    router.get('/', validate({ query: InboxQuerySchema }), async (req, res, next) => {
        try {
            const principal = await getCallerPrincipal(req);
            const query = (res.locals.validated?.query ?? req.query);
            const page = await inboxService.list(query, principal);
            res.status(200).json(page);
        }
        catch (err) {
            next(err);
        }
    });
    // 2. GET /v1/inbox/summary - Aggregated summary counts
    registerRoute({
        method: 'get',
        path: '/v1/inbox/summary',
        tags: ['Alerts', 'Inbox'],
        summary: 'Aggregated summary counts and top crews by priority (F097)',
        description: 'Provides dashboard overview counts by workflow status, severity, unacknowledged critical alerts, and top priority crews.',
        successResponse: {
            status: 200,
            description: 'InboxSummary aggregated metrics',
            schema: InboxSummarySchema,
        },
    });
    router.get('/summary', async (req, res, next) => {
        try {
            const principal = await getCallerPrincipal(req);
            const summary = await inboxService.getSummary(principal);
            res.status(200).json(summary);
        }
        catch (err) {
            next(err);
        }
    });
    // 3. GET /v1/inbox/:id - Detailed fused alert card
    registerRoute({
        method: 'get',
        path: '/v1/inbox/{id}',
        tags: ['Alerts', 'Inbox'],
        summary: 'Get detailed fused alert card by ID (F097)',
        description: 'Returns full detail including member raw alerts, ML factors, explanation, timeline, and resolution fields with role-based projection.',
        request: {
            params: ParamIdSchema,
        },
        successResponse: {
            status: 200,
            description: 'InboxItemDTO detail',
            schema: InboxItemDTOSchema,
        },
    });
    router.get('/:id', async (req, res, next) => {
        try {
            const principal = await getCallerPrincipal(req);
            const item = await inboxService.getById(String(req.params['id']), principal);
            res.status(200).json(item);
        }
        catch (err) {
            next(err);
        }
    });
    // 4. POST /v1/inbox/:id/acknowledge
    registerRoute({
        method: 'post',
        path: '/v1/inbox/{id}/acknowledge',
        tags: ['Alerts', 'Inbox'],
        summary: 'Acknowledge an inbox alert card (F097)',
        description: 'Transitions alert from open/snoozed to acknowledged. If condition is cleared, resolves immediately. Astronauts may acknowledge own crew items.',
        request: {
            params: ParamIdSchema,
            body: {
                content: {
                    'application/json': {
                        schema: AcknowledgeBodySchema,
                    },
                },
            },
        },
        successResponse: {
            status: 200,
            description: 'Acknowledge action result',
            schema: ActionResponseSchema,
        },
    });
    router.post('/:id/acknowledge', validate({ body: AcknowledgeBodySchema }), async (req, res, next) => {
        try {
            const principal = await getCallerPrincipal(req);
            const body = (res.locals.validated?.body ?? req.body);
            const requestId = getRequestId();
            const result = await inboxService.acknowledge(String(req.params['id']), body, principal, requestId);
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    });
    // 5. POST /v1/inbox/:id/assign
    registerRoute({
        method: 'post',
        path: '/v1/inbox/{id}/assign',
        tags: ['Alerts', 'Inbox'],
        summary: 'Assign an alert card to a medical officer or surgeon (F097)',
        description: 'Assigns alert to a user (or "me") or unassigns (null). Requires flight_surgeon, admin, or medical-officer astronaut privileges.',
        request: {
            params: ParamIdSchema,
            body: {
                content: {
                    'application/json': {
                        schema: AssignBodySchema,
                    },
                },
            },
        },
        successResponse: {
            status: 200,
            description: 'Assign action result',
            schema: ActionResponseSchema,
        },
    });
    router.post('/:id/assign', validate({ body: AssignBodySchema }), async (req, res, next) => {
        try {
            const principal = await getCallerPrincipal(req);
            const body = (res.locals.validated?.body ?? req.body);
            const requestId = getRequestId();
            const result = await inboxService.assign(String(req.params['id']), body, principal, requestId);
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    });
    // 6. POST /v1/inbox/:id/snooze
    registerRoute({
        method: 'post',
        path: '/v1/inbox/{id}/snooze',
        tags: ['Alerts', 'Inbox'],
        summary: 'Snooze an alert card with clinical duration and reason (F097)',
        description: 'Temporarily snoozes watch or warning alerts. Critical alerts cannot be snoozed. Requires medical privileges.',
        request: {
            params: ParamIdSchema,
            body: {
                content: {
                    'application/json': {
                        schema: SnoozeBodySchema,
                    },
                },
            },
        },
        successResponse: {
            status: 200,
            description: 'Snooze action result',
            schema: ActionResponseSchema,
        },
    });
    router.post('/:id/snooze', validate({ body: SnoozeBodySchema }), async (req, res, next) => {
        try {
            const principal = await getCallerPrincipal(req);
            const body = (res.locals.validated?.body ?? req.body);
            const requestId = getRequestId();
            const result = await inboxService.snooze(String(req.params['id']), body, principal, requestId);
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    });
    // 7. POST /v1/inbox/:id/unsnooze
    registerRoute({
        method: 'post',
        path: '/v1/inbox/{id}/unsnooze',
        tags: ['Alerts', 'Inbox'],
        summary: 'Unsnooze an alert card back to open status (F097)',
        description: 'Cancels an active snooze, returning the alert to open status. Requires medical privileges.',
        request: {
            params: ParamIdSchema,
            body: {
                content: {
                    'application/json': {
                        schema: UnsnoozeBodySchema,
                    },
                },
            },
        },
        successResponse: {
            status: 200,
            description: 'Unsnooze action result',
            schema: ActionResponseSchema,
        },
    });
    router.post('/:id/unsnooze', validate({ body: UnsnoozeBodySchema }), async (req, res, next) => {
        try {
            const principal = await getCallerPrincipal(req);
            const body = (res.locals.validated?.body ?? req.body);
            const requestId = getRequestId();
            const result = await inboxService.unsnooze(String(req.params['id']), body, principal, requestId);
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    });
    // 8. POST /v1/inbox/:id/resolve
    registerRoute({
        method: 'post',
        path: '/v1/inbox/{id}/resolve',
        tags: ['Alerts', 'Inbox'],
        summary: 'Resolve an alert card (manual or dismissal) (F097)',
        description: 'Resolves an alert. If condition is active, resolution_note (>=10 chars) is mandatory and alert is marked dismissed with suppression window. Requires medical privileges.',
        request: {
            params: ParamIdSchema,
            body: {
                content: {
                    'application/json': {
                        schema: ResolveBodySchema,
                    },
                },
            },
        },
        successResponse: {
            status: 200,
            description: 'Resolve action result',
            schema: ActionResponseSchema,
        },
    });
    router.post('/:id/resolve', validate({ body: ResolveBodySchema }), async (req, res, next) => {
        try {
            const principal = await getCallerPrincipal(req);
            const body = (res.locals.validated?.body ?? req.body);
            const requestId = getRequestId();
            const result = await inboxService.resolve(String(req.params['id']), body, principal, requestId);
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    });
    // 9. POST /v1/inbox/:id/notes
    registerRoute({
        method: 'post',
        path: '/v1/inbox/{id}/notes',
        tags: ['Alerts', 'Inbox'],
        summary: 'Add a clinical note to the timeline (F097)',
        description: 'Appends a free-text note (max 1000 chars) to the alert timeline. Allowed in any status including resolved. Requires medical privileges.',
        request: {
            params: ParamIdSchema,
            body: {
                content: {
                    'application/json': {
                        schema: AddNoteBodySchema,
                    },
                },
            },
        },
        successResponse: {
            status: 200,
            description: 'Note addition result',
            schema: ActionResponseSchema,
        },
    });
    router.post('/:id/notes', validate({ body: AddNoteBodySchema }), async (req, res, next) => {
        try {
            const principal = await getCallerPrincipal(req);
            const body = (res.locals.validated?.body ?? req.body);
            const requestId = getRequestId();
            const result = await inboxService.addNote(String(req.params['id']), body, principal, requestId);
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
