import { describe, it, expect } from 'vitest';
import { canReceive, projectForRole, type Principal } from '../src/bus/audience.js';
import { type Envelope } from '../src/bus/eventTypes.js';

describe('Audience and Projection Rules (F118)', () => {
  const admin: Principal = { userId: 'u-admin', role: 'admin' };
  const surgeon: Principal = { userId: 'u-surg', role: 'flight_surgeon' };
  const mc: Principal = { userId: 'u-mc', role: 'mission_control' };
  const astroA: Principal = { userId: 'u-astroA', role: 'astronaut', crewId: 'crew-1' };
  const astroB: Principal = { userId: 'u-astroB', role: 'astronaut', crewId: 'crew-2' };
  const astroOfficer: Principal = {
    userId: 'u-astroOfficer',
    role: 'astronaut',
    crewId: 'crew-1',
    isMedicalOfficer: true,
  };

  const sampleAlertCrew1: Envelope = {
    uid: '00000000-0000-0000-0000-000000000001',
    id: '1000-0',
    topic: 'alerts',
    type: 'alert.raised',
    crew_id: 'crew-1',
    severity: 'warning',
    audience: 'all',
    emitted_at: new Date().toISOString(),
    mission_mode: 'mars',
    request_id: null,
    payload: { metric: 'heart_rate', value: 140 },
  };

  const sampleEmergency: Envelope = {
    uid: '00000000-0000-0000-0000-000000000002',
    id: '1000-1',
    topic: 'emergency',
    type: 'emergency.declared',
    crew_id: 'crew-1',
    severity: 'critical',
    audience: 'all',
    emitted_at: new Date().toISOString(),
    mission_mode: 'mars',
    request_id: null,
    payload: {
      declared_by: 'u-astroA',
      type: 'cardiac',
      note: 'Severe chest pains and arrhythmia',
      resolution_note: 'Administered nitroglycerin',
      medical_history: 'Confidential records',
    },
  };

  const sampleSystem: Envelope = {
    uid: '00000000-0000-0000-0000-000000000003',
    id: '1000-2',
    topic: 'system',
    type: 'system.notice',
    crew_id: null,
    severity: 'info',
    audience: 'all',
    emitted_at: new Date().toISOString(),
    mission_mode: 'mars',
    request_id: null,
    payload: { message: 'Routine telemetry calibration' },
  };

  describe('canReceive', () => {
    it('allows admin, flight_surgeon, mission_control to receive all events', () => {
      for (const p of [admin, surgeon, mc]) {
        expect(canReceive(sampleAlertCrew1, p)).toBe(true);
        expect(canReceive(sampleEmergency, p)).toBe(true);
        expect(canReceive(sampleSystem, p)).toBe(true);
      }
    });

    it('allows astronauts to receive events for their own crew, but not another crew', () => {
      expect(canReceive(sampleAlertCrew1, astroA)).toBe(true);
      expect(canReceive(sampleAlertCrew1, astroB)).toBe(false);
    });

    it('allows all astronauts to receive emergency events regardless of crew', () => {
      expect(canReceive(sampleEmergency, astroA)).toBe(true);
      expect(canReceive(sampleEmergency, astroB)).toBe(true);
    });

    it('allows all roles to receive system events', () => {
      expect(canReceive(sampleSystem, astroA)).toBe(true);
      expect(canReceive(sampleSystem, astroB)).toBe(true);
    });
  });

  describe('projectForRole', () => {
    it('always strips medical_history from payloads', () => {
      const proj = projectForRole(sampleEmergency, admin);
      expect(proj.payload['medical_history']).toBeUndefined();
    });

    it('retains emergency notes for declaring user, medical officer, surgeon, and admin', () => {
      expect(projectForRole(sampleEmergency, astroA).payload['note']).toBe(
        'Severe chest pains and arrhythmia',
      );
      expect(projectForRole(sampleEmergency, astroOfficer).payload['note']).toBe(
        'Severe chest pains and arrhythmia',
      );
      expect(projectForRole(sampleEmergency, surgeon).payload['note']).toBe(
        'Severe chest pains and arrhythmia',
      );
      expect(projectForRole(sampleEmergency, admin).payload['note']).toBe(
        'Severe chest pains and arrhythmia',
      );
    });

    it('redacts free-text notes for mission_control and non-declaring non-officer astronauts', () => {
      const projMc = projectForRole(sampleEmergency, mc);
      expect(projMc.payload['note']).toBeUndefined();
      expect(projMc.payload['resolution_note']).toBeUndefined();

      const projAstroB = projectForRole(sampleEmergency, astroB);
      expect(projAstroB.payload['note']).toBeUndefined();
      expect(projAstroB.payload['resolution_note']).toBeUndefined();
    });
  });
});
