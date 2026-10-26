/**
 * @module routes/v1/protocols
 * Onboard Medical Guidance & Autonomous Decision API Routes (Phase 4).
 */
import { Router } from 'express';
import { registerRoute } from '../../core/openapi.js';
import { authenticate, requireRole } from '../../core/security.js';
import { validate } from '../../middleware/validate.js';
import { ProtocolsListResponseSchema, ProtocolDetailResponseSchema, AutonomousDecisionLogDTOSchema, ReconcileDecisionsResponseSchema, CompleteProtocolStepBodySchema, ReconcileDecisionsBodySchema, } from '../../schemas/protocols.js';
import { z } from 'zod';
export function createV1ProtocolsRouter(deps) {
    const router = Router();
    const { protocolService } = deps;
    // 1. GET /v1/protocols
    registerRoute({
        method: 'get',
        path: '/v1/protocols',
        tags: ['Protocols'],
        summary: 'List onboard clinical emergency checklists (Phase 4)',
        description: 'Provides protocol checklists for primary hazard types (cardiovascular, respiratory, thermal, etc.) and reports whether autonomous mode is active.',
        successResponse: {
            status: 200,
            description: 'List of available protocols and autonomous mode state',
            schema: ProtocolsListResponseSchema,
        },
    });
    router.get('/', authenticate, async (req, res, next) => {
        try {
            const hazardType = req.query['hazard_type'];
            const result = await protocolService.getProtocols(hazardType);
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    });
    // 2. GET /v1/protocols/decisions (placed before /:id)
    registerRoute({
        method: 'get',
        path: '/v1/protocols/decisions',
        tags: ['Protocols'],
        summary: 'List logged autonomous medical decisions',
        description: 'Retrieves decisions executed by the Crew Medical Officer during comms blackout or local triage, including vital signs snapshot and link state.',
        successResponse: {
            status: 200,
            description: 'List of logged autonomous decisions',
            schema: z.array(AutonomousDecisionLogDTOSchema),
        },
    });
    router.get('/decisions', authenticate, async (req, res, next) => {
        try {
            const reconciledParam = req.query['reconciled'];
            const reconciled = reconciledParam !== undefined ? reconciledParam === 'true' : undefined;
            const emergencyId = req.query['emergency_id'];
            const crewId = req.query['crew_id'];
            const limit = Number(req.query['limit'] ?? 100);
            const decisions = await protocolService.getDecisions({
                reconciled,
                emergency_id: emergencyId,
                crew_id: crewId,
                limit,
            });
            res.status(200).json(decisions);
        }
        catch (err) {
            next(err);
        }
    });
    // 3. POST /v1/protocols/decisions/reconcile (placed before /:id)
    registerRoute({
        method: 'post',
        path: '/v1/protocols/decisions/reconcile',
        tags: ['Protocols'],
        summary: 'Reconcile autonomous decisions upon comms reconnection',
        description: 'Ground Flight Surgeon reviews and reconciles clinical decisions taken autonomously during blackout. Restricted to flight_surgeon or admin.',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: ReconcileDecisionsBodySchema,
                    },
                },
            },
        },
        successResponse: {
            status: 200,
            description: 'Reconciled decisions response',
            schema: ReconcileDecisionsResponseSchema,
        },
    });
    router.post('/decisions/reconcile', authenticate, requireRole('flight_surgeon', 'admin'), validate({ body: ReconcileDecisionsBodySchema }), async (req, res, next) => {
        try {
            const body = req.body;
            const actorId = req.auth?.userId ?? 'ground_surgeon';
            const actorRole = req.auth?.role ?? 'flight_surgeon';
            const result = await protocolService.reconcileDecisions({
                decisionIds: body.decision_ids,
                reviewNotes: body.review_notes,
                status: body.status,
                reconciledBy: actorId,
                actorRole,
            });
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    });
    // 4. GET /v1/protocols/:id
    registerRoute({
        method: 'get',
        path: '/v1/protocols/{id}',
        tags: ['Protocols'],
        summary: 'Get details of a specific clinical protocol checklist',
        description: 'Retrieves all steps, indications, and instructions for a clinical protocol.',
        successResponse: {
            status: 200,
            description: 'Protocol checklist detail',
            schema: ProtocolDetailResponseSchema,
        },
    });
    router.get('/:id', authenticate, async (req, res, next) => {
        try {
            const protocolId = req.params['id'];
            const result = await protocolService.getProtocolById(protocolId);
            res.status(200).json(result);
        }
        catch (err) {
            next(err);
        }
    });
    // 5. POST /v1/protocols/:id/steps/:stepId/complete
    registerRoute({
        method: 'post',
        path: '/v1/protocols/{id}/steps/{stepId}/complete',
        tags: ['Protocols'],
        summary: 'Complete a protocol step and log autonomous clinical decision',
        description: 'Crew Medical Officer completes an emergency clinical step, records vital signs and observations, and enqueues the action for DTN ground sync.',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: CompleteProtocolStepBodySchema,
                    },
                },
            },
        },
        successResponse: {
            status: 201,
            description: 'Logged autonomous clinical decision',
            schema: AutonomousDecisionLogDTOSchema,
        },
    });
    router.post('/:id/steps/:stepId/complete', authenticate, validate({ body: CompleteProtocolStepBodySchema }), async (req, res, next) => {
        try {
            const protocolId = req.params['id'];
            const stepId = req.params['stepId'];
            const body = req.body;
            const actorId = req.auth?.userId ?? 'cmo';
            const actorRole = req.auth?.role ?? 'astronaut';
            const isMedicalOfficer = Boolean(req.auth?.isMedicalOfficer);
            const decision = await protocolService.completeStep({
                protocolId,
                stepId,
                emergencyId: body.emergency_id,
                crewId: body.crew_id,
                actionTaken: body.action_taken,
                notes: body.notes,
                vitalSignsSnapshot: body.vital_signs_snapshot,
                actorId,
                actorRole,
                isMedicalOfficer,
            });
            res.status(201).json(decision);
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
