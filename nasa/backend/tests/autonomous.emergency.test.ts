/**
 * End-to-end integration tests simulating a Comms Blackout mid-emergency (Phase 4).
 *
 * Verifies:
 * - Mid-emergency blackout onset and link state tracking
 * - Onboard medical guidance / protocol checklists exposed during blackout
 * - Role-based authorization (Crew Medical Officer permission required)
 * - Autonomous decision logging with telemetry and link state snapshots
 * - Store-and-forward queue buffering
 * - Conflict-safe queue sync upon comms reconnection
 * - Flight Surgeon post-reconnect reconciliation of autonomous decisions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestMongo, teardownTestMongo, clearTestMongo, createTestApp } from './helpers.js';
import { signAccessToken } from '../src/core/tokens.js';
import { User } from '../src/models/User.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { hashPassword } from '../src/core/passwords.js';

describe('Delay-Tolerant Autonomy & Blackout Mid-Emergency (Phase 4)', () => {
  let settings: ReturnType<typeof createTestApp>['settings'];
  let agent: ReturnType<typeof createTestApp>['agent'];

  let cmoToken: string;
  let astronautToken: string;
  let flightSurgeonToken: string;
  let adminToken: string;
  let patientToken: string;

  let patientCrewId: string;

  beforeEach(async () => {
    await setupTestMongo();
    await clearTestMongo();

    const testApp = createTestApp();
    settings = testApp.settings;
    agent = testApp.agent;

    const passwordHash = await hashPassword('Password123!');

    // 1. Crew Profile for Patient Astronaut
    const patientCrew = await CrewProfile.create({
      first_name: 'Alex',
      last_name: 'Vance',
      role: 'mission_specialist',
      callsign: 'Nova',
      age: 34,
      sex: 'female',
      height_cm: 170,
      weight_kg: 64,
      baseline: {
        resting_hr: 65,
        max_hr: 180,
        spo2_nominal: 98,
        systolic_bp: 115,
        diastolic_bp: 75,
        resp_rate: 14,
        core_temp: 36.8,
      },
    });
    patientCrewId = String(patientCrew._id);

    // 2. Patient Astronaut User
    const patientUser = await User.create({
      email: 'alex.vance@nasa.gov',
      display_name: 'Alex Vance',
      password_hash: passwordHash,
      role: 'astronaut',
      crew_profile_id: patientCrew._id,
      is_active: true,
    });

    // 3. Crew Medical Officer (CMO) User with is_medical_officer = true
    const cmoUser = await User.create({
      email: 'dr.stone@nasa.gov',
      display_name: 'Dr. Ryan Stone',
      password_hash: passwordHash,
      role: 'astronaut',
      is_medical_officer: true,
      is_active: true,
    });

    // 4. Regular Astronaut User (Non-CMO)
    const regularUser = await User.create({
      email: 'pilot.bob@nasa.gov',
      display_name: 'Bob Behnken',
      password_hash: passwordHash,
      role: 'astronaut',
      is_medical_officer: false,
      is_active: true,
    });

    // 5. Flight Surgeon User (Ground Medical Officer)
    const surgeonUser = await User.create({
      email: 'surgeon.houston@nasa.gov',
      display_name: 'Dr. Houston Surgeon',
      password_hash: passwordHash,
      role: 'flight_surgeon',
      is_active: true,
    });

    // 6. Mission Administrator
    const adminUser = await User.create({
      email: 'admin.director@nasa.gov',
      display_name: 'Flight Director Gene',
      password_hash: passwordHash,
      role: 'admin',
      is_active: true,
    });

    // Generate JWT access tokens
    cmoToken = signAccessToken(
      {
        userId: String(cmoUser._id),
        role: 'astronaut',
        isMedicalOfficer: true,
      },
      settings.jwt_access_secret,
    );

    astronautToken = signAccessToken(
      {
        userId: String(regularUser._id),
        role: 'astronaut',
        isMedicalOfficer: false,
      },
      settings.jwt_access_secret,
    );

    flightSurgeonToken = signAccessToken(
      {
        userId: String(surgeonUser._id),
        role: 'flight_surgeon',
        isMedicalOfficer: false,
      },
      settings.jwt_access_secret,
    );

    adminToken = signAccessToken(
      {
        userId: String(adminUser._id),
        role: 'admin',
        isMedicalOfficer: false,
      },
      settings.jwt_access_secret,
    );

    patientToken = signAccessToken(
      {
        userId: String(patientUser._id),
        role: 'astronaut',
        isMedicalOfficer: false,
      },
      settings.jwt_access_secret,
    );
  });

  afterEach(async () => {
    await teardownTestMongo();
  });

  it('executes autonomous protocol guidance during mid-emergency blackout and reconciles upon reconnect', async () => {
    // -------------------------------------------------------------------------
    // Phase A: Mid-Emergency Declaration
    // -------------------------------------------------------------------------
    const { randomUUID } = await import('node:crypto');
    const clientRequestId = randomUUID();

    const emergencyRes = await agent
      .post('/v1/emergencies')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        type: 'cardiac',
        note: 'Acute telemetry alert: sustained ventricular tachycardia 168 bpm with dizziness',
        source: 'button',
        client_request_id: clientRequestId,
      });

    expect(emergencyRes.status).toBe(201);
    const emergencyId = emergencyRes.body.emergency.id;
    expect(emergencyId).toBeDefined();
    expect(emergencyRes.body.emergency.status).toBe('active');

    // -------------------------------------------------------------------------
    // Phase B: Comms Blackout Window Hits Mid-Emergency
    // -------------------------------------------------------------------------
    const overrideRes = await agent
      .post('/v1/link/override')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        direction: 'downlink',
        force_blackout: true,
      });

    expect(overrideRes.status).toBe(200);
    expect(overrideRes.body.in_blackout).toBe(true);
    expect(overrideRes.body.override_active).toBe(true);

    // Verify GET /v1/link/state confirms link is down
    const linkStateRes = await agent
      .get('/v1/link/state')
      .set('Authorization', `Bearer ${cmoToken}`);

    expect(linkStateRes.status).toBe(200);
    expect(linkStateRes.body.in_blackout).toBe(true);

    // -------------------------------------------------------------------------
    // Phase C: Autonomous Guidance & Clinical Protocols Access
    // -------------------------------------------------------------------------
    const protocolsRes = await agent
      .get('/v1/protocols?hazard_type=cardiovascular')
      .set('Authorization', `Bearer ${cmoToken}`);

    expect(protocolsRes.status).toBe(200);
    expect(protocolsRes.body.autonomous_mode_active).toBe(true);
    expect(protocolsRes.body.protocols).toHaveLength(1);
    const cvProtocol = protocolsRes.body.protocols[0]!;
    expect(cvProtocol.protocol_id).toBe('PROTO-CV-01');
    expect(cvProtocol.hazard_type).toBe('cardiovascular');

    // Check specific protocol details
    const protoDetailRes = await agent
      .get(`/v1/protocols/${cvProtocol.protocol_id}`)
      .set('Authorization', `Bearer ${cmoToken}`);

    expect(protoDetailRes.status).toBe(200);
    expect(protoDetailRes.body.protocol.steps.length).toBeGreaterThanOrEqual(4);

    // -------------------------------------------------------------------------
    // Phase D: RBAC Enforcement — Non-CMO Astronaut is Forbidden
    // -------------------------------------------------------------------------
    const unauthorizedRes = await agent
      .post(`/v1/protocols/${cvProtocol.protocol_id}/steps/cv-s1/complete`)
      .set('Authorization', `Bearer ${astronautToken}`)
      .send({
        emergency_id: emergencyId,
        crew_id: patientCrewId,
        action_taken: 'Attempting medical procedure without CMO authorization',
      });

    expect(unauthorizedRes.status).toBe(403);
    expect(unauthorizedRes.body.error.code).toBe('FORBIDDEN');

    // -------------------------------------------------------------------------
    // Phase E: CMO Executes Autonomous Clinical Protocol Steps
    // -------------------------------------------------------------------------
    // Step 1: Ingress into Crew Medical Restraint
    const step1Res = await agent
      .post(`/v1/protocols/${cvProtocol.protocol_id}/steps/cv-s1/complete`)
      .set('Authorization', `Bearer ${cmoToken}`)
      .send({
        emergency_id: emergencyId,
        crew_id: patientCrewId,
        action_taken:
          'Patient secured in CMR; continuous ECG leads attached and carotid pulse confirmed',
        notes: 'Patient conscious but pale, HR 165 bpm, SpO2 89%',
        vital_signs_snapshot: { hr: 165, spo2: 89, sbp: 88, dbp: 56 },
      });

    expect(step1Res.status).toBe(201);
    const decision1Id = step1Res.body.decision_id;
    expect(decision1Id).toBeDefined();
    expect(step1Res.body.reconciled).toBe(false);
    expect(step1Res.body.link_state_at_decision.in_blackout).toBe(true);

    // Step 3: Antiarrhythmic pharmacotherapy (Adenosine flush)
    const step3Res = await agent
      .post(`/v1/protocols/${cvProtocol.protocol_id}/steps/cv-s3/complete`)
      .set('Authorization', `Bearer ${cmoToken}`)
      .send({
        emergency_id: emergencyId,
        crew_id: patientCrewId,
        action_taken: 'Administered Adenosine 6mg rapid IV bolus with 20mL saline flush',
        notes: 'Brief 3-second pause on ECG followed by conversion to sinus tachycardia 102 bpm',
        vital_signs_snapshot: { hr: 102, spo2: 96, sbp: 112, dbp: 72 },
      });

    expect(step3Res.status).toBe(201);
    const decision2Id = step3Res.body.decision_id;
    expect(decision2Id).toBeDefined();
    expect(step3Res.body.reconciled).toBe(false);

    // -------------------------------------------------------------------------
    // Phase F: Store-and-Forward Queue Buffers Messages During Blackout
    // -------------------------------------------------------------------------
    // Ground flight surgeon also transmits a directive during blackout
    const groundSendRes = await agent
      .post('/v1/link/queue/send')
      .set('Authorization', `Bearer ${flightSurgeonToken}`)
      .send({
        direction: 'uplink',
        type: 'clinical_directive',
        target_id: emergencyId,
        payload: {
          emergency_id: emergencyId,
          advice: 'Recommend continuous telemetry observation before drug intervention',
        },
        idempotency_key: `ground-directive-${emergencyId}`,
      });

    expect(groundSendRes.status).toBe(201);
    expect(groundSendRes.body.status).toBe('queued');

    // Inspect DTN queue
    const queueRes = await agent.get('/v1/link/queue').set('Authorization', `Bearer ${cmoToken}`);

    expect(queueRes.status).toBe(200);
    expect(queueRes.body.length).toBeGreaterThanOrEqual(3);

    // -------------------------------------------------------------------------
    // Phase G: Comms Reconnects & Conflict-Safe Synchronization
    // -------------------------------------------------------------------------
    // Clear blackout override
    const clearRes = await agent
      .delete('/v1/link/override?direction=downlink')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(clearRes.status).toBe(200);
    expect(clearRes.body.in_blackout).toBe(false);

    // Trigger DTN sync on reconnect
    const syncRes = await agent
      .post('/v1/link/sync')
      .set('Authorization', `Bearer ${flightSurgeonToken}`);

    expect(syncRes.status).toBe(200);
    expect(syncRes.body.ok).toBe(true);
    // Onboard life-safety actions took precedence over conflicting delayed ground directive
    expect(syncRes.body.conflicts_count).toBeGreaterThanOrEqual(1);

    // -------------------------------------------------------------------------
    // Phase H: Flight Surgeon Reconciles Autonomous Decisions Post-Blackout
    // -------------------------------------------------------------------------
    // 1. Fetch un-reconciled decisions
    const pendingDecisionsRes = await agent
      .get('/v1/protocols/decisions?reconciled=false')
      .set('Authorization', `Bearer ${flightSurgeonToken}`);

    expect(pendingDecisionsRes.status).toBe(200);
    expect(pendingDecisionsRes.body).toHaveLength(2);
    expect(pendingDecisionsRes.body.map((d: { decision_id: string }) => d.decision_id)).toEqual(
      expect.arrayContaining([decision1Id, decision2Id]),
    );

    // 2. Reconcile both decisions with flight surgeon clinical sign-off
    const reconcileRes = await agent
      .post('/v1/protocols/decisions/reconcile')
      .set('Authorization', `Bearer ${flightSurgeonToken}`)
      .send({
        decision_ids: [decision1Id, decision2Id],
        review_notes:
          'Retrospectively reviewed by Houston Flight Surgeon: CMO emergency protocol adherence validated. Rapid IV Adenosine administration was clinically appropriate and restored sinus rhythm.',
        status: 'accepted',
      });

    expect(reconcileRes.status).toBe(200);
    expect(reconcileRes.body.reconciled_count).toBe(2);
    expect(reconcileRes.body.decisions).toHaveLength(2);
    expect(reconcileRes.body.decisions[0].reconciled).toBe(true);
    expect(reconcileRes.body.decisions[0].reconciliation_status).toBe('accepted');
    expect(reconcileRes.body.decisions[0].reconciliation_notes).toContain('Houston Flight Surgeon');

    // 3. Confirm no pending decisions remain
    const remainingPendingRes = await agent
      .get('/v1/protocols/decisions?reconciled=false')
      .set('Authorization', `Bearer ${flightSurgeonToken}`);

    expect(remainingPendingRes.status).toBe(200);
    expect(remainingPendingRes.body).toHaveLength(0);

    // 4. Confirm reconciled decisions are queryable
    const reconciledListRes = await agent
      .get('/v1/protocols/decisions?reconciled=true')
      .set('Authorization', `Bearer ${flightSurgeonToken}`);

    expect(reconciledListRes.status).toBe(200);
    expect(reconciledListRes.body).toHaveLength(2);
  });

  it('exposes protocol checklists for all 6 spaceflight hazard types and handles 404 for unknown protocol', async () => {
    // 1. Fetch all protocols without hazard filter
    const allRes = await agent.get('/v1/protocols').set('Authorization', `Bearer ${cmoToken}`);

    expect(allRes.status).toBe(200);
    expect(allRes.body.protocols).toHaveLength(6);

    const hazards = allRes.body.protocols.map((p: { hazard_type: string }) => p.hazard_type);
    expect(hazards).toEqual(
      expect.arrayContaining([
        'cardiovascular',
        'respiratory',
        'thermal',
        'autonomic_stress',
        'cabin_environment',
        'radiation',
      ]),
    );

    // 2. Fetch nonexistent protocol returns 404
    const notFoundRes = await agent
      .get('/v1/protocols/NON-EXISTENT-PROTO')
      .set('Authorization', `Bearer ${cmoToken}`);

    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body.error.code).toBe('NOT_FOUND');
  });
});
