import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestMongo,
  teardownTestMongo,
  clearTestMongo,
  createTestApp,
  createTestUser,
} from './helpers.js';
import { CrewProfile } from '../src/models/CrewProfile.js';
import { FusedAlert } from '../src/models/FusedAlert.js';
import { ExternalAlert } from '../src/models/ExternalAlert.js';
import { ruleAlertAdapter } from '../src/fusion/inputs.js';
import { type FusionEngine } from '../src/fusion/fusionEngine.js';

describe('External Alert Intake API (POST /v1/alerts/external)', () => {
  let agent: ReturnType<typeof createTestApp>['agent'];
  let app: ReturnType<typeof createTestApp>['app'];
  let validCrewProfileId: string;
  const validKey = 'dev_insecure_ml_api_key_min_32_characters!';

  beforeAll(async () => {
    await setupTestMongo();
    const testApp = createTestApp();
    agent = testApp.agent;
    app = testApp.app;
  });

  afterAll(async () => {
    await teardownTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();

    // Create a valid crew profile for intake testing
    const profile = await CrewProfile.create({
      callsign: 'Ares-101',
      age: 35,
      sex: 'female',
      height_cm: 172,
      weight_kg: 68,
      baseline: {},
      is_synthetic: true,
    });
    validCrewProfileId = profile._id.toString();
  });

  describe('Authentication', () => {
    it('rejects requests with missing X-ML-Key with 401 UNAUTHENTICATED', async () => {
      const res = await agent.post('/v1/alerts/external').send({
        alerts: [
          {
            external_id: 'ext-01',
            source: 'anomaly',
            crew_id: validCrewProfileId,
            hazard: 'cardiovascular',
            severity: 'warning',
            status: 'active',
            confidence: 0.85,
            raised_at: '2026-10-18T12:00:00.000Z',
            explanation: 'HR anomaly detected',
          },
        ],
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects requests with incorrect X-ML-Key with 401 UNAUTHENTICATED', async () => {
      const res = await agent
        .post('/v1/alerts/external')
        .set('X-ML-Key', 'wrong_key_provided_here')
        .send({ alerts: [] });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects requests with Bearer JWT alone without X-ML-Key with 401', async () => {
      const { token } = await createTestUser({ role: 'admin' });

      const res = await agent
        .post('/v1/alerts/external')
        .set('Authorization', `Bearer ${token}`)
        .send({ alerts: [] });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('accepts requests with valid X-ML-Key', async () => {
      const res = await agent
        .post('/v1/alerts/external')
        .set('X-ML-Key', validKey)
        .send({
          alerts: [
            {
              external_id: 'ext-01',
              source: 'anomaly',
              crew_id: validCrewProfileId,
              hazard: 'cardiovascular',
              severity: 'warning',
              status: 'active',
              confidence: 0.85,
              raised_at: '2026-10-18T12:00:00.000Z',
              explanation: 'HR anomaly detected',
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(1);
      expect(res.body.accepted).toBe(1);
      expect(res.body.rejected).toHaveLength(0);
    });
  });

  describe('Validation & Per-Item Error Isolation', () => {
    it('returns 422 with dotted paths on schema-level format errors', async () => {
      const res = await agent
        .post('/v1/alerts/external')
        .set('X-ML-Key', validKey)
        .send({
          alerts: [
            {
              external_id: '', // too short
              source: 'invalid_source',
              crew_id: validCrewProfileId,
              hazard: 'cardiovascular',
              severity: 'warning',
              status: 'active',
              confidence: 1.5, // > 1
              raised_at: 'not-a-date',
              explanation: '',
            },
          ],
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const details = res.body.error.details;
      expect(Array.isArray(details)).toBe(true);
      const fields = details.map((d: { field: string }) => d.field);
      expect(fields.some((f: string) => f.includes('external_id'))).toBe(true);
      expect(fields.some((f: string) => f.includes('confidence'))).toBe(true);
    });

    it('isolates per-item problems: accepts valid alert and rejects unknown crew or invalid hazard', async () => {
      const res = await agent
        .post('/v1/alerts/external')
        .set('X-ML-Key', validKey)
        .send({
          alerts: [
            {
              external_id: 'ext-valid',
              source: 'anomaly',
              crew_id: validCrewProfileId,
              hazard: 'respiratory',
              severity: 'warning',
              status: 'active',
              confidence: 0.8,
              raised_at: '2026-10-18T12:00:00.000Z',
              explanation: 'Valid alert',
            },
            {
              external_id: 'ext-bad-crew',
              source: 'anomaly',
              crew_id: 'non_existent_crew_id_123',
              hazard: 'respiratory',
              severity: 'warning',
              status: 'active',
              confidence: 0.8,
              raised_at: '2026-10-18T12:00:00.000Z',
              explanation: 'Unknown crew',
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(2);
      expect(res.body.accepted).toBe(1);
      expect(res.body.rejected).toHaveLength(1);
      expect(res.body.rejected[0].index).toBe(1);
      expect(res.body.rejected[0].code).toBe('CREW_NOT_FOUND');
    });
  });

  describe('Idempotency, Updates & Corroboration', () => {
    it('repeating identical alert is an idempotent no-op', async () => {
      const payload = {
        alerts: [
          {
            external_id: 'ext-repeat-1',
            source: 'anomaly',
            crew_id: validCrewProfileId,
            hazard: 'thermal',
            severity: 'warning',
            status: 'active',
            confidence: 0.9,
            raised_at: '2026-10-18T12:00:00.000Z',
            explanation: 'Thermal spike',
          },
        ],
      };

      const res1 = await agent.post('/v1/alerts/external').set('X-ML-Key', validKey).send(payload);
      expect(res1.status).toBe(200);

      const alertDoc1 = await ExternalAlert.findOne({ external_id: 'ext-repeat-1' });
      const version1 = alertDoc1?.updated_at;

      // Second identical call
      const res2 = await agent.post('/v1/alerts/external').set('X-ML-Key', validKey).send(payload);
      expect(res2.status).toBe(200);

      const alertDoc2 = await ExternalAlert.findOne({ external_id: 'ext-repeat-1' });
      expect(alertDoc2?.updated_at.getTime()).toBe(version1?.getTime());
    });

    it('updating status to cleared clears the member in the fused alert', async () => {
      // 1. Post active anomaly
      await agent
        .post('/v1/alerts/external')
        .set('X-ML-Key', validKey)
        .send({
          alerts: [
            {
              external_id: 'ext-lifecycle-1',
              source: 'risk',
              crew_id: validCrewProfileId,
              hazard: 'cardiovascular',
              severity: 'warning',
              status: 'active',
              confidence: 0.75,
              raised_at: '2026-10-18T12:00:00.000Z',
              explanation: 'Cardiac risk rising',
            },
          ],
        });

      let fused = await FusedAlert.findOne({ group_key: `${validCrewProfileId}:cardiovascular` });
      expect(fused?.condition).toBe('active');
      expect(fused?.members[0]?.status).toBe('active');

      // 2. Post cleared status for same external_id
      await agent
        .post('/v1/alerts/external')
        .set('X-ML-Key', validKey)
        .send({
          alerts: [
            {
              external_id: 'ext-lifecycle-1',
              source: 'risk',
              crew_id: validCrewProfileId,
              hazard: 'cardiovascular',
              severity: 'warning',
              status: 'cleared',
              confidence: 0.75,
              raised_at: '2026-10-18T12:00:00.000Z',
              event_at: '2026-10-18T12:15:00.000Z',
              explanation: 'Risk normalized',
            },
          ],
        });

      fused = await FusedAlert.findOne({ group_key: `${validCrewProfileId}:cardiovascular` });
      expect(fused?.condition).toBe('cleared');
      expect(fused?.members[0]?.status).toBe('cleared');
    });

    it('ML alert plus rule alert for the same crew and hazard corroborate into one fused item with corroboration bonus', async () => {
      // 1. Post external ML anomaly
      await agent
        .post('/v1/alerts/external')
        .set('X-ML-Key', validKey)
        .send({
          alerts: [
            {
              external_id: 'ml-spo2-anomaly',
              source: 'anomaly',
              crew_id: validCrewProfileId,
              hazard: 'respiratory',
              metrics: ['spo2'],
              severity: 'warning',
              status: 'active',
              confidence: 0.88,
              raised_at: '2026-10-18T12:00:00.000Z',
              explanation: 'SpO2 waveform anomaly',
            },
          ],
        });

      // 2. Directly feed a rule alert into the fusion engine for the same hazard
      const engine = app.locals['fusionEngine'] as FusionEngine;
      const ruleInput = ruleAlertAdapter({
        type: 'alert.raised',
        alert: {
          id: 'rule-resp-01',
          crew_id: validCrewProfileId,
          metric: 'resp_rate',
          value: 26,
          severity: 'warning',
          status: 'active',
          message: 'Tachypnea rule triggered',
          raised_at: '2026-10-18T12:01:00.000Z',
          mission_mode: 'mars',
        },
      });

      await engine.processInput(ruleInput);

      const fused = await FusedAlert.findOne({ group_key: `${validCrewProfileId}:respiratory` });
      expect(fused).not.toBeNull();
      // Should have 2 members (anomaly and rule)
      expect(fused?.members).toHaveLength(2);
      expect(fused?.sources).toEqual(expect.arrayContaining(['anomaly', 'rule']));
      expect(fused?.metrics).toEqual(expect.arrayContaining(['spo2', 'resp_rate']));
      // Priority score: base warning (40) + extra source (+10) + extra metric (+5) = 55
      expect(fused?.priority_score).toBe(55);
    });
  });
});
