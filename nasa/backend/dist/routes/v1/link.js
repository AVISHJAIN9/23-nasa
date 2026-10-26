/**
 * @module routes/v1/link
 * Comms Link Emulator & Delay-Tolerant Store-and-Forward API Routes (Phase 4 / F070).
 */
import { Router } from 'express';
import { registerRoute } from '../../core/openapi.js';
import { authenticate, requireRole } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import { LinkEvent } from '../../models/LinkEvent.js';
import { LinkStateDTOSchema, LinkOverrideBodySchema, DtnSendBodySchema, DtnMessageDTOSchema, DtnSyncResponseSchema, LinkEventDTOSchema, } from '../../schemas/link.js';
import { z } from 'zod';
export function createV1LinkRouter(deps) {
    const router = Router();
    const { settings, emulator, dtnQueue } = deps;
    // 1. GET /v1/link/state
    registerRoute({
        method: 'get',
        path: '/v1/link/state',
        tags: ['Link'],
        summary: 'Get current communication link state (F070 / Phase 4)',
        description: 'Returns the effective one-way comms delay, blackout status, packet loss rate, and mission mode.',
        successResponse: {
            status: 200,
            description: 'Current link state snapshot',
            schema: LinkStateDTOSchema,
        },
    });
    router.get('/state', authenticate, async (_req, res, next) => {
        try {
            const state = await emulator.getState();
            res.status(200).json({
                effective_delay_ms: state.effectiveDelayMs,
                in_blackout: state.inBlackout,
                blackout_label: state.blackoutLabel,
                packet_loss_rate: state.packetLossRate,
                override_active: state.overrideActive,
                mission_mode: settings.mission_mode,
                computed_at: state.computedAt,
            });
        }
        catch (err) {
            next(err);
        }
    });
    // 2. GET /v1/link/events
    registerRoute({
        method: 'get',
        path: '/v1/link/events',
        tags: ['Link'],
        summary: 'Get link event audit trail',
        description: 'Retrieves historical link evaluation and blackout transition events.',
        successResponse: {
            status: 200,
            description: 'List of link events',
            schema: z.array(LinkEventDTOSchema),
        },
    });
    router.get('/events', authenticate, async (req, res, next) => {
        try {
            const limit = Math.min(Number(req.query['limit'] ?? 50), 200);
            const docs = await LinkEvent.find().sort({ occurred_at: -1 }).limit(limit).lean();
            res.status(200).json(docs.map((d) => ({
                id: String(d._id),
                kind: d.kind,
                mission_mode: d.mission_mode,
                delay_ms: d.delay_ms,
                in_blackout: d.in_blackout,
                blackout_label: d.blackout_label ?? null,
                override_active: d.override_active,
                occurred_at: d.occurred_at.toISOString(),
            })));
        }
        catch (err) {
            next(err);
        }
    });
    // 3. POST /v1/link/override
    registerRoute({
        method: 'post',
        path: '/v1/link/override',
        tags: ['Link'],
        summary: 'Apply administrative comms link override',
        description: 'Force specific delay, blackout state, or packet loss rate. Restricted to admin / flight director.',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: LinkOverrideBodySchema,
                    },
                },
            },
        },
        successResponse: {
            status: 200,
            description: 'Updated link state after override',
            schema: LinkStateDTOSchema,
        },
    });
    router.post('/override', authenticate, requireRole('admin', 'flight_director'), validate({ body: LinkOverrideBodySchema }), async (req, res, next) => {
        try {
            const body = req.body;
            const actorId = req.auth?.userId ?? 'admin';
            const direction = body.direction ?? 'downlink';
            const expiresAt = body.expires_in_seconds !== undefined
                ? Date.now() + body.expires_in_seconds * 1000
                : undefined;
            const updatedState = await emulator.setOverride(direction, {
                force_delay_ms: body.force_delay_ms,
                force_blackout: body.force_blackout,
                force_packet_loss_rate: body.force_packet_loss_rate,
                actor_id: actorId,
                expires_at: expiresAt,
            });
            res.status(200).json({
                effective_delay_ms: updatedState.effectiveDelayMs,
                in_blackout: updatedState.inBlackout,
                blackout_label: updatedState.blackoutLabel,
                packet_loss_rate: updatedState.packetLossRate,
                override_active: updatedState.overrideActive,
                mission_mode: settings.mission_mode,
                computed_at: updatedState.computedAt,
            });
        }
        catch (err) {
            next(err);
        }
    });
    // 4. DELETE /v1/link/override
    registerRoute({
        method: 'delete',
        path: '/v1/link/override',
        tags: ['Link'],
        summary: 'Clear administrative comms link override',
        description: 'Restores calculated mission profile delay and blackout model. Restricted to admin / flight director.',
        successResponse: {
            status: 200,
            description: 'Restored link state',
            schema: LinkStateDTOSchema,
        },
    });
    router.delete('/override', authenticate, requireRole('admin', 'flight_director'), async (req, res, next) => {
        try {
            const direction = req.query['direction'] ?? 'downlink';
            const restoredState = await emulator.clearOverride(direction);
            res.status(200).json({
                effective_delay_ms: restoredState.effectiveDelayMs,
                in_blackout: restoredState.inBlackout,
                blackout_label: restoredState.blackoutLabel,
                packet_loss_rate: restoredState.packetLossRate,
                override_active: restoredState.overrideActive,
                mission_mode: settings.mission_mode,
                computed_at: restoredState.computedAt,
            });
        }
        catch (err) {
            next(err);
        }
    });
    // 5. POST /v1/link/queue/send
    registerRoute({
        method: 'post',
        path: '/v1/link/queue/send',
        tags: ['Link'],
        summary: 'Enqueue message into store-and-forward DTN queue',
        description: 'Enqueues ground-to-onboard or onboard-to-ground message with deduplication and delay evaluation.',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: DtnSendBodySchema,
                    },
                },
            },
        },
        successResponse: {
            status: 201,
            description: 'Enqueued DTN message',
            schema: DtnMessageDTOSchema,
        },
    });
    router.post('/queue/send', authenticate, validate({ body: DtnSendBodySchema }), async (req, res, next) => {
        try {
            const body = req.body;
            const actorId = req.auth?.userId ?? 'anonymous';
            const actorRole = req.auth?.role ?? 'astronaut';
            const item = await dtnQueue.enqueue({
                direction: body.direction,
                sender_id: actorId,
                sender_role: actorRole,
                type: body.type,
                target_id: body.target_id,
                payload: body.payload,
                idempotency_key: body.idempotency_key,
            });
            res.status(201).json(item);
        }
        catch (err) {
            next(err);
        }
    });
    // 6. GET /v1/link/queue
    registerRoute({
        method: 'get',
        path: '/v1/link/queue',
        tags: ['Link'],
        summary: 'List messages in DTN store-and-forward queue',
        description: 'Lists queued, in-flight, and delivered messages ordered by sequence number.',
        successResponse: {
            status: 200,
            description: 'Array of DTN messages',
            schema: z.array(DtnMessageDTOSchema),
        },
    });
    router.get('/queue', authenticate, async (req, res, next) => {
        try {
            const direction = req.query['direction'];
            const status = req.query['status'];
            const targetId = req.query['target_id'];
            const limit = Number(req.query['limit'] ?? 100);
            const items = await dtnQueue.getQueue({
                direction,
                status,
                target_id: targetId,
                limit,
            });
            res.status(200).json(items);
        }
        catch (err) {
            next(err);
        }
    });
    // 7. POST /v1/link/sync
    registerRoute({
        method: 'post',
        path: '/v1/link/sync',
        tags: ['Link'],
        summary: 'Trigger store-and-forward reconnect sync',
        description: 'Drains eligible queued/in-flight messages upon comms reconnection, applying conflict-safe reconciliation.',
        successResponse: {
            status: 200,
            description: 'Reconnection sync results',
            schema: DtnSyncResponseSchema,
        },
    });
    router.post('/sync', authenticate, async (req, res, next) => {
        try {
            const actorId = req.auth?.userId ?? 'system';
            const result = await dtnQueue.syncOnReconnect({
                reconciledBy: actorId,
            });
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
