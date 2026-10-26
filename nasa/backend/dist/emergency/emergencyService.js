import { randomUUID } from 'node:crypto';
import { Emergency } from '../models/Emergency.js';
import { transitionEmergency } from './stateMachine.js';
import { projectForRole } from '../bus/audience.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../core/errors.js';
import { getRequestId } from '../core/requestContext.js';
import { originForRole } from '../bus/origin.js';
export function toEmergencyDTO(doc) {
    return {
        id: String(doc._id),
        crew_id: String(doc.crew_id),
        declared_by: String(doc.declared_by),
        type: doc.type,
        note: doc.note,
        source: doc.source,
        status: doc.status,
        declared_at: doc.declared_at.toISOString(),
        acknowledged_by: (doc.acknowledged_by || []).map((ack) => ({
            user_id: ack.user_id,
            at: ack.at instanceof Date ? ack.at.toISOString() : new Date(ack.at).toISOString(),
        })),
        resolved_at: doc.resolved_at ? doc.resolved_at.toISOString() : null,
        resolved_by: doc.resolved_by ?? null,
        resolution_note: doc.resolution_note ?? null,
        cancelled_at: doc.cancelled_at ? doc.cancelled_at.toISOString() : null,
        cancelled_by: doc.cancelled_by ?? null,
        mission_mode: doc.mission_mode,
        mission_day: doc.mission_day ?? null,
        protocol_id: doc.protocol_id ?? null,
        client_request_id: doc.client_request_id,
        created_at: doc.created_at ? doc.created_at.toISOString() : new Date().toISOString(),
        updated_at: doc.updated_at ? doc.updated_at.toISOString() : new Date().toISOString(),
    };
}
export class EmergencyService {
    bus;
    auditWriter;
    settings;
    constructor(deps) {
        this.bus = deps.eventBus;
        this.auditWriter = deps.auditWriter;
        this.settings = deps.settings;
    }
    async declare(input) {
        const { caller, body } = input;
        // 1. Resolve crew_id
        let targetCrewId;
        if (caller.role === 'astronaut') {
            if (!caller.crewId) {
                throw new ForbiddenError('Caller is not linked to any crew profile');
            }
            if (body.crew_id && body.crew_id !== caller.crewId) {
                throw new ForbiddenError('Astronauts may only declare emergencies for their own crew');
            }
            targetCrewId = caller.crewId;
        }
        else if (caller.role === 'admin') {
            if (!body.crew_id) {
                throw new BadRequestError('crew_id is required when declared by an admin');
            }
            targetCrewId = body.crew_id;
        }
        else {
            throw new ForbiddenError('Only astronauts and admins may declare an emergency');
        }
        // 2. Idempotency Rule 1: same client_request_id by the same user
        const existingSameRequest = await Emergency.findOne({
            declared_by: caller.userId,
            client_request_id: body.client_request_id,
        });
        if (existingSameRequest) {
            const dto = toEmergencyDTO(existingSameRequest);
            return {
                emergency: dto,
                broadcast: { event_id: null, uid: randomUUID(), bus: 'ok' },
                statusCode: 200,
            };
        }
        // 3. Deduplication Rule 2: active/acknowledged emergency for same crew and type within dedupe window
        const dedupeWindowMs = (this.settings.emergency_dedupe_s ?? 30) * 1000;
        const dedupeThreshold = new Date(Date.now() - dedupeWindowMs);
        const existingRecent = await Emergency.findOne({
            crew_id: targetCrewId,
            type: body.type,
            status: { $in: ['active', 'acknowledged'] },
            declared_at: { $gte: dedupeThreshold },
        });
        if (existingRecent) {
            const dto = toEmergencyDTO(existingRecent);
            return {
                emergency: dto,
                broadcast: { event_id: null, uid: randomUUID(), bus: 'ok' },
                deduplicated: true,
                statusCode: 200,
            };
        }
        // 4. Order of Operations:
        // (a) Persist to Mongo FIRST
        const requestId = getRequestId();
        const doc = await Emergency.create({
            crew_id: targetCrewId,
            declared_by: caller.userId,
            type: body.type,
            note: body.note,
            source: body.source,
            status: 'active',
            declared_at: new Date(),
            acknowledged_by: [],
            mission_mode: this.settings.mission_mode,
            client_request_id: body.client_request_id,
            request_id: requestId,
        });
        // (b) Write Audit Entry SECOND (if this fails, execution throws and bus event is NEVER published)
        await this.auditWriter.write({
            actor_id: caller.userId,
            action: 'EMERGENCY_DECLARED',
            target_id: String(doc._id),
            metadata: {
                crew_id: targetCrewId,
                type: body.type,
                client_request_id: body.client_request_id,
            },
        });
        const dto = toEmergencyDTO(doc);
        // (c) Publish to Event Bus LAST (bus failures never cause request to fail)
        let broadcast;
        try {
            const pubRes = await this.bus.publish({
                topic: 'emergency',
                type: 'emergency.declared',
                crew_id: targetCrewId,
                severity: 'critical',
                audience: 'all',
                origin: originForRole(caller.role),
                request_id: requestId,
                payload: dto,
            });
            broadcast = {
                event_id: pubRes.id,
                uid: pubRes.uid,
                bus: pubRes.bus,
            };
        }
        catch {
            broadcast = {
                event_id: null,
                uid: randomUUID(),
                bus: 'degraded',
            };
        }
        return {
            emergency: dto,
            broadcast,
            statusCode: 201,
        };
    }
    async getById(id, caller) {
        const doc = await Emergency.findById(id);
        if (!doc) {
            throw new NotFoundError(`Emergency '${id}' not found`);
        }
        const dto = toEmergencyDTO(doc);
        // Project free-text note based on caller role
        const eventProjection = projectForRole({
            uid: randomUUID(),
            id: null,
            topic: 'emergency',
            type: 'emergency.get',
            crew_id: dto.crew_id,
            audience: 'all',
            emitted_at: dto.declared_at,
            mission_mode: dto.mission_mode,
            payload: dto,
        }, caller);
        return eventProjection.payload;
    }
    async list(query, caller) {
        const filter = {};
        if (caller.role === 'astronaut') {
            filter['crew_id'] = caller.crewId;
        }
        else if (query.crew_id) {
            filter['crew_id'] = query.crew_id;
        }
        if (query.status) {
            filter['status'] = query.status;
        }
        if (query.from || query.to) {
            const dateFilter = {};
            if (query.from)
                dateFilter['$gte'] = new Date(query.from);
            if (query.to)
                dateFilter['$lte'] = new Date(query.to);
            filter['declared_at'] = dateFilter;
        }
        if (query.cursor) {
            filter['_id'] = { $lt: query.cursor };
        }
        const limit = query.limit ?? 20;
        const docs = await Emergency.find(filter)
            .sort({ declared_at: -1, _id: -1 })
            .limit(limit + 1);
        const hasMore = docs.length > limit;
        const pageDocs = hasMore ? docs.slice(0, limit) : docs;
        const nextCursor = hasMore ? String(pageDocs[pageDocs.length - 1]?._id) : null;
        const items = pageDocs.map((d) => {
            const dto = toEmergencyDTO(d);
            const proj = projectForRole({
                uid: randomUUID(),
                id: null,
                topic: 'emergency',
                type: 'emergency.list',
                crew_id: dto.crew_id,
                audience: 'all',
                emitted_at: dto.declared_at,
                mission_mode: dto.mission_mode,
                payload: dto,
            }, caller);
            return proj.payload;
        });
        return {
            items,
            next_cursor: nextCursor,
        };
    }
    async acknowledge(id, caller) {
        const doc = await Emergency.findById(id);
        if (!doc) {
            throw new NotFoundError(`Emergency '${id}' not found`);
        }
        const nextState = transitionEmergency({
            status: doc.status,
            acknowledged_by: doc.acknowledged_by,
            resolved_at: doc.resolved_at,
            resolved_by: doc.resolved_by,
            resolution_note: doc.resolution_note,
            cancelled_at: doc.cancelled_at,
            cancelled_by: doc.cancelled_by,
        }, { type: 'ACKNOWLEDGE', userId: caller.userId });
        doc.status = nextState.status;
        doc.acknowledged_by = nextState.acknowledged_by;
        await doc.save();
        await this.auditWriter.write({
            actor_id: caller.userId,
            action: 'EMERGENCY_ACKNOWLEDGED',
            target_id: String(doc._id),
        });
        const dto = toEmergencyDTO(doc);
        let broadcast;
        try {
            const pubRes = await this.bus.publish({
                topic: 'emergency',
                type: 'emergency.acknowledged',
                crew_id: dto.crew_id,
                severity: 'critical',
                audience: 'all',
                origin: originForRole(caller.role),
                payload: dto,
            });
            broadcast = { event_id: pubRes.id, uid: pubRes.uid, bus: pubRes.bus };
        }
        catch {
            broadcast = { event_id: null, uid: randomUUID(), bus: 'degraded' };
        }
        return { emergency: dto, broadcast };
    }
    async resolve(id, caller, resolutionNote) {
        if (caller.role !== 'flight_surgeon' && caller.role !== 'admin') {
            throw new ForbiddenError('Only Flight Surgeons and Admins may resolve an emergency');
        }
        const doc = await Emergency.findById(id);
        if (!doc) {
            throw new NotFoundError(`Emergency '${id}' not found`);
        }
        const nextState = transitionEmergency({
            status: doc.status,
            acknowledged_by: doc.acknowledged_by,
            resolved_at: doc.resolved_at,
            resolved_by: doc.resolved_by,
            resolution_note: doc.resolution_note,
            cancelled_at: doc.cancelled_at,
            cancelled_by: doc.cancelled_by,
        }, {
            type: 'RESOLVE',
            userId: caller.userId,
            resolutionNote,
        });
        doc.status = nextState.status;
        doc.resolved_at = nextState.resolved_at;
        doc.resolved_by = nextState.resolved_by;
        doc.resolution_note = nextState.resolution_note;
        await doc.save();
        await this.auditWriter.write({
            actor_id: caller.userId,
            action: 'EMERGENCY_RESOLVED',
            target_id: String(doc._id),
            metadata: { resolution_note: resolutionNote },
        });
        const dto = toEmergencyDTO(doc);
        let broadcast;
        try {
            const pubRes = await this.bus.publish({
                topic: 'emergency',
                type: 'emergency.resolved',
                crew_id: dto.crew_id,
                severity: 'info',
                audience: 'all',
                origin: originForRole(caller.role),
                payload: dto,
            });
            broadcast = { event_id: pubRes.id, uid: pubRes.uid, bus: pubRes.bus };
        }
        catch {
            broadcast = { event_id: null, uid: randomUUID(), bus: 'degraded' };
        }
        return { emergency: dto, broadcast };
    }
    async cancel(id, caller) {
        const doc = await Emergency.findById(id);
        if (!doc) {
            throw new NotFoundError(`Emergency '${id}' not found`);
        }
        // Cancellation authorization and window check
        if (caller.role !== 'admin') {
            if (String(doc.declared_by) !== caller.userId) {
                throw new ForbiddenError('Only the declaring astronaut or an admin may cancel this emergency');
            }
            const cancelWindowS = this.settings.emergency_cancel_window_s ?? 60;
            const elapsedS = (Date.now() - doc.declared_at.getTime()) / 1000;
            if (elapsedS > cancelWindowS) {
                throw new ConflictError(`Emergency cancellation window (${cancelWindowS}s) has expired`);
            }
        }
        const nextState = transitionEmergency({
            status: doc.status,
            acknowledged_by: doc.acknowledged_by,
            resolved_at: doc.resolved_at,
            resolved_by: doc.resolved_by,
            resolution_note: doc.resolution_note,
            cancelled_at: doc.cancelled_at,
            cancelled_by: doc.cancelled_by,
        }, { type: 'CANCEL', userId: caller.userId });
        doc.status = nextState.status;
        doc.cancelled_at = nextState.cancelled_at;
        doc.cancelled_by = nextState.cancelled_by;
        await doc.save();
        await this.auditWriter.write({
            actor_id: caller.userId,
            action: 'EMERGENCY_CANCELLED',
            target_id: String(doc._id),
        });
        const dto = toEmergencyDTO(doc);
        let broadcast;
        try {
            const pubRes = await this.bus.publish({
                topic: 'emergency',
                type: 'emergency.cancelled',
                crew_id: dto.crew_id,
                severity: 'info',
                audience: 'all',
                origin: originForRole(caller.role),
                payload: dto,
            });
            broadcast = { event_id: pubRes.id, uid: pubRes.uid, bus: pubRes.bus };
        }
        catch {
            broadcast = { event_id: null, uid: randomUUID(), bus: 'degraded' };
        }
        return { emergency: dto, broadcast };
    }
}
