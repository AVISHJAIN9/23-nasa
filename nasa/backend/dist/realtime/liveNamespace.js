import { randomUUID } from 'node:crypto';
import { NoDelayPolicy } from '../bus/deliveryPolicy.js';
import { canReceive, projectForRole } from '../bus/audience.js';
import { isValidStreamId, compareStreamIds } from '../bus/eventTypes.js';
import { verifyAccessToken } from '../core/tokens.js';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { AppError, UnauthenticatedError, TokenExpiredError, ForbiddenError, } from '../core/errors.js';
export function registerLiveNamespace(liveNamespace, deps) {
    const { settings, eventBus, commsDelayEmulator } = deps;
    const policy = deps.deliveryPolicy ?? new NoDelayPolicy();
    // Broadcast link state changes to all connected live namespace clients
    if (commsDelayEmulator) {
        commsDelayEmulator.onChange((_prev, next) => {
            liveNamespace.emit('link:state', next);
        });
    }
    // Handshake Authentication Middleware
    liveNamespace.use(async (socket, next) => {
        try {
            const auth = (socket.handshake.auth || {});
            const headers = socket.handshake.headers || {};
            let token = (typeof auth['token'] === 'string' ? auth['token'] : undefined) ??
                (typeof auth['jwt'] === 'string' ? auth['jwt'] : undefined);
            if (!token && typeof headers['authorization'] === 'string') {
                const parts = headers['authorization'].split(' ');
                if (parts.length === 2 && parts[0]?.toLowerCase() === 'bearer') {
                    token = parts[1];
                }
            }
            if (!token) {
                throw new UnauthenticatedError('Authentication token required in handshake auth');
            }
            // Verify token
            const secret = settings.jwt_access_secret;
            const decoded = verifyAccessToken(token, secret);
            // Validate last_event_id if provided
            const rawLastEventId = auth['last_event_id'] ?? auth['lastEventId'];
            let lastEventId = null;
            if (rawLastEventId !== undefined && rawLastEventId !== null) {
                if (typeof rawLastEventId !== 'string' || !isValidStreamId(rawLastEventId)) {
                    const validationError = new AppError('VALIDATION_ERROR', `Malformed last_event_id: '${String(rawLastEventId)}'`);
                    return next(Object.assign(new Error(validationError.message), {
                        data: {
                            code: validationError.code,
                            message: validationError.message,
                            request_id: randomUUID(),
                        },
                    }));
                }
                lastEventId = rawLastEventId;
            }
            // Resolve crew_id for astronaut
            let crewId = null;
            if (decoded.role === 'astronaut') {
                try {
                    if (mongoose.Types.ObjectId.isValid(decoded.sub)) {
                        const user = await User.findById(decoded.sub).lean();
                        if (user?.crew_profile_id) {
                            crewId = String(user.crew_profile_id);
                        }
                    }
                }
                catch {
                    // ignore invalid id in test tokens
                }
            }
            const principal = {
                userId: decoded.sub,
                role: decoded.role,
                isMedicalOfficer: Boolean(decoded.mo),
                crewId,
            };
            socket.data['principal'] = principal;
            socket.data['tokenExp'] = decoded.exp;
            socket.data['lastEventId'] = lastEventId;
            next();
        }
        catch (err) {
            let appErr;
            if (err instanceof TokenExpiredError) {
                appErr = err;
            }
            else if (err instanceof AppError) {
                appErr = err;
            }
            else {
                appErr = new UnauthenticatedError(err.message || 'Handshake authentication failed');
            }
            const customErr = new Error(appErr.message);
            customErr.data = {
                code: appErr.code,
                message: appErr.message,
                request_id: randomUUID(),
                details: appErr.details,
            };
            next(customErr);
        }
    });
    // Socket Connection Lifecycle
    liveNamespace.on('connection', async (socket) => {
        const principal = socket.data['principal'];
        const initialLastEventId = socket.data['lastEventId'];
        let tokenExp = socket.data['tokenExp'];
        // Join Rooms
        socket.join('all');
        socket.join(`role:${principal.role}`);
        if (principal.crewId) {
            socket.join(`crew:${principal.crewId}`);
        }
        // Per-socket state for deduplication and ordered replay handoff
        const sentUids = new Set();
        const uidOrder = [];
        let lastSentId = initialLastEventId;
        let isReplaying = true;
        const liveBuffer = [];
        const pendingTimers = new Set();
        const recordUid = (uid) => {
            sentUids.add(uid);
            uidOrder.push(uid);
            if (uidOrder.length > 1000) {
                const oldest = uidOrder.shift();
                if (oldest)
                    sentUids.delete(oldest);
            }
        };
        const emitToSocket = (event) => {
            if (!socket.connected)
                return;
            if (sentUids.has(event.uid))
                return;
            recordUid(event.uid);
            if (event.id) {
                lastSentId = event.id;
            }
            const projected = projectForRole(event, principal);
            const delay = policy.deliverAfterMs(event, principal.role);
            if (delay > 0) {
                const timer = setTimeout(() => {
                    pendingTimers.delete(timer);
                    if (socket.connected) {
                        if (event.topic === 'telemetry') {
                            socket.volatile.emit('event', projected);
                        }
                        else {
                            socket.emit('event', projected);
                        }
                    }
                }, delay);
                pendingTimers.add(timer);
            }
            else {
                if (event.topic === 'telemetry') {
                    socket.volatile.emit('event', projected);
                }
                else {
                    socket.emit('event', projected);
                }
            }
        };
        // 1. Subscribe to live events on the bus
        const unsubBus = eventBus.subscribe((event) => {
            if (!socket.connected)
                return;
            if (!canReceive(event, principal))
                return;
            if (isReplaying) {
                liveBuffer.push(event);
            }
            else {
                emitToSocket(event);
            }
        });
        // 2. Token Expiry Timers
        let warnTimer = null;
        let expireTimer = null;
        const setupTokenTimers = (expSeconds) => {
            if (warnTimer)
                clearTimeout(warnTimer);
            if (expireTimer)
                clearTimeout(expireTimer);
            const nowMs = Date.now();
            const expMs = expSeconds * 1000;
            const warnLeadMs = (settings.socket_auth_refresh_warn_s ?? 60) * 1000;
            const timeToWarn = Math.max(0, expMs - nowMs - warnLeadMs);
            const timeToExpire = Math.max(0, expMs - nowMs);
            warnTimer = setTimeout(() => {
                if (socket.connected) {
                    socket.emit('auth:expiring', {
                        expires_at: new Date(expMs).toISOString(),
                    });
                }
            }, timeToWarn);
            expireTimer = setTimeout(() => {
                if (socket.connected) {
                    socket.emit('auth:expired', {
                        reason: 'TOKEN_EXPIRED',
                    });
                    socket.disconnect(true);
                }
            }, timeToExpire);
        };
        setupTokenTimers(tokenExp);
        // 3. Client Events: auth:refresh
        socket.on('auth:refresh', (payload, ack) => {
            try {
                const rawToken = typeof payload === 'object' && payload !== null
                    ? payload['token']
                    : undefined;
                if (typeof rawToken !== 'string') {
                    throw new UnauthenticatedError('Missing token in auth:refresh payload');
                }
                const decoded = verifyAccessToken(rawToken, settings.jwt_access_secret);
                if (decoded.sub !== principal.userId) {
                    throw new ForbiddenError('Token subject does not match authenticated socket user');
                }
                if (!decoded.exp) {
                    throw new UnauthenticatedError('Access token is missing exp claim');
                }
                tokenExp = decoded.exp;
                setupTokenTimers(tokenExp);
                const newExpiresAt = new Date(decoded.exp * 1000).toISOString();
                if (typeof ack === 'function') {
                    ack({ ok: true, expires_at: newExpiresAt });
                }
            }
            catch (err) {
                const appErr = err instanceof AppError ? err : new UnauthenticatedError(err.message);
                if (typeof ack === 'function') {
                    ack({
                        error: {
                            code: appErr.code,
                            message: appErr.message,
                            request_id: randomUUID(),
                            details: appErr.details,
                        },
                    });
                }
            }
        });
        // 4. Client Events: ping:app
        socket.on('ping:app', (ack) => {
            if (typeof ack === 'function') {
                ack({ server_time: new Date().toISOString() });
            }
        });
        // 5. Run Replay or Hello Protocol
        try {
            if (initialLastEventId) {
                const info = eventBus.info();
                socket.emit('replay:begin', {
                    from_id: initialLastEventId,
                    head_id: info.head_id,
                });
                const replayLimit = settings.bus_replay_max_events ?? 1000;
                const replayRes = await eventBus.replay(initialLastEventId, {
                    limit: replayLimit,
                    filter: (e) => canReceive(e, principal),
                });
                if (replayRes.reset) {
                    socket.emit('replay:resync', {
                        reason: 'reset',
                        resync: ['GET /v1/alerts?status=active', 'GET /v1/emergencies?status=active'],
                    });
                }
                else if (replayRes.truncated) {
                    socket.emit('replay:resync', {
                        reason: 'truncated',
                        resync: ['GET /v1/alerts?status=active', 'GET /v1/emergencies?status=active'],
                    });
                }
                for (const replayedEvent of replayRes.events) {
                    emitToSocket(replayedEvent);
                }
                socket.emit('replay:end', {
                    count: replayRes.events.length,
                    last_id: lastSentId,
                    truncated: replayRes.truncated,
                });
            }
            else {
                const info = eventBus.info();
                const linkState = commsDelayEmulator?.getCachedState() ?? null;
                socket.emit('hello', {
                    head_id: info.head_id,
                    server_time: new Date().toISOString(),
                    mission_mode: settings.mission_mode,
                    ...(linkState ? { link_state: linkState } : {}),
                });
            }
        }
        catch (err) {
            logger.warn({ err: err.message }, 'Error during socket replay');
        }
        finally {
            // Replay complete: Flush live event buffer
            isReplaying = false;
            for (const buffered of liveBuffer) {
                if (buffered.id && lastSentId && compareStreamIds(buffered.id, lastSentId) <= 0) {
                    continue;
                }
                emitToSocket(buffered);
            }
            liveBuffer.length = 0;
        }
        // Cleanup on disconnect
        socket.on('disconnect', () => {
            unsubBus();
            if (warnTimer)
                clearTimeout(warnTimer);
            if (expireTimer)
                clearTimeout(expireTimer);
            for (const timer of pendingTimers) {
                clearTimeout(timer);
            }
            pendingTimers.clear();
            liveBuffer.length = 0;
        });
    });
}
