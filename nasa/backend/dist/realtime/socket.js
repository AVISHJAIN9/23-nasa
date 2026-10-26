import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { AppError, UnauthenticatedError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { resolveIngestPrincipal } from '../telemetry/ingestAuth.js';
import { computePayloadHash, resolveIdempotencyKey, MongoIdempotencyStore, } from '../telemetry/idempotency.js';
import { ingestBatch } from '../telemetry/ingestService.js';
import { TelemetryBatchRequestSchema } from '../schemas/telemetry.js';
import { registerLiveNamespace } from './liveNamespace.js';
/**
 * Creates and attaches the Socket.IO server to the HTTP server.
 * Registers the /ingest namespace for high-throughput, low-latency streaming.
 */
export function createSocketServer(httpServer, deps) {
    const io = new Server(httpServer, {
        cors: {
            origin: deps.settings.cors_origins,
            credentials: true,
        },
        maxHttpBufferSize: 1e6, // 1 MB limit
    });
    const ingestNamespace = io.of('/ingest');
    // Handshake authentication middleware
    ingestNamespace.use(async (socket, next) => {
        try {
            const auth = (socket.handshake.auth || {});
            const headers = socket.handshake.headers || {};
            const ingestKey = (typeof auth['ingest_key'] === 'string' ? auth['ingest_key'] : undefined) ??
                (typeof auth['ingestKey'] === 'string' ? auth['ingestKey'] : undefined) ??
                (typeof headers['x-ingest-key'] === 'string' ? headers['x-ingest-key'] : undefined);
            let token = (typeof auth['token'] === 'string' ? auth['token'] : undefined) ??
                (typeof auth['jwt'] === 'string' ? auth['jwt'] : undefined);
            if (!token && typeof headers['authorization'] === 'string') {
                const parts = headers['authorization'].split(' ');
                if (parts.length === 2 && parts[0]?.toLowerCase() === 'bearer') {
                    token = parts[1];
                }
            }
            const principal = await resolveIngestPrincipal({
                ingestKey,
                token,
            }, deps.settings);
            socket.data.principal = principal;
            next();
        }
        catch (err) {
            const appErr = err instanceof AppError ? err : new UnauthenticatedError('Handshake authentication failed');
            const connectionError = new Error(appErr.message);
            connectionError.data = {
                code: appErr.code,
                message: appErr.message,
                ...(appErr.details ? { details: appErr.details } : {}),
            };
            next(connectionError);
        }
    });
    // Namespace connection handler
    ingestNamespace.on('connection', (socket) => {
        logger.debug({ socketId: socket.id }, 'Ingest socket connected');
        socket.on('telemetry:batch', async (payload, ack) => {
            const requestId = randomUUID();
            try {
                // 1. Zod payload validation
                const parseResult = TelemetryBatchRequestSchema.safeParse(payload);
                if (!parseResult.success) {
                    const details = parseResult.error.issues.map((issue) => ({
                        field: issue.path.join('.') || 'request',
                        issue: issue.message,
                    }));
                    if (typeof ack === 'function') {
                        ack({
                            error: {
                                code: 'VALIDATION_ERROR',
                                message: 'Request validation failed',
                                request_id: requestId,
                                details,
                            },
                        });
                    }
                    return;
                }
                const batch = parseResult.data;
                const principal = socket.data.principal;
                const idempotencyStore = deps.idempotencyStore ?? new MongoIdempotencyStore();
                // 2. Idempotency reservation
                const payloadHash = computePayloadHash(payload);
                const idempotencyKey = resolveIdempotencyKey(undefined, batch.batch_id, payloadHash);
                const reservation = await idempotencyStore.reserve(principal.scope, idempotencyKey, payloadHash);
                if (reservation.isReplay) {
                    if (typeof ack === 'function') {
                        ack(reservation.response);
                    }
                    return;
                }
                // 3. Process batch ingestion
                try {
                    const response = await ingestBatch(batch, principal, deps);
                    await idempotencyStore.complete(principal.scope, idempotencyKey, response);
                    if (typeof ack === 'function') {
                        ack(response);
                    }
                }
                catch (err) {
                    await idempotencyStore.rollback(principal.scope, idempotencyKey);
                    throw err;
                }
            }
            catch (err) {
                logger.warn({ err, socketId: socket.id }, 'Error processing telemetry:batch event');
                if (typeof ack === 'function') {
                    const isAppErr = err instanceof AppError;
                    ack({
                        error: {
                            code: isAppErr ? err.code : 'INTERNAL_ERROR',
                            message: isAppErr ? err.message : 'An unexpected server error occurred',
                            request_id: requestId,
                            ...(isAppErr && err.details ? { details: err.details } : {}),
                        },
                    });
                }
            }
        });
        socket.on('disconnect', (reason) => {
            logger.debug({ socketId: socket.id, reason }, 'Ingest socket disconnected');
        });
    });
    if (deps.eventBus) {
        const liveNamespace = io.of('/live');
        registerLiveNamespace(liveNamespace, {
            settings: deps.settings,
            eventBus: deps.eventBus,
            deliveryPolicy: deps.deliveryPolicy,
            commsDelayEmulator: deps.commsDelayEmulator,
        });
    }
    return io;
}
