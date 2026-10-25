import { describe, it, expect } from 'vitest';
import {
  applyMemberEvent,
  computePriority,
  isSuppressedByDismissal,
  pruneMembers,
  type FusedMember,
} from '../src/fusion/fusionCore.js';
import { getHazardForMetric } from '../src/fusion/hazards.js';
import { type FusionInput, ruleAlertAdapter, externalAlertAdapter } from '../src/fusion/inputs.js';

describe('Fusion Core Pure Logic (F049)', () => {
  const defaultOpts = {
    minConfidence: 0.5,
    maxMembers: 50,
    timelineMax: 200,
  };

  describe('Hazard Mapping & Grouping', () => {
    it('maps metrics of the same hazard correctly and unmapped metrics to general', () => {
      expect(getHazardForMetric('spo2')).toBe('respiratory');
      expect(getHazardForMetric('resp_rate')).toBe('respiratory');
      expect(getHazardForMetric('heart_rate')).toBe('cardiovascular');
      expect(getHazardForMetric('systolic')).toBe('cardiovascular');
      expect(getHazardForMetric('diastolic')).toBe('cardiovascular');
      expect(getHazardForMetric('temp_c')).toBe('thermal');
      expect(getHazardForMetric('hrv_rmssd')).toBe('autonomic_stress');
      expect(getHazardForMetric('unknown_sensor')).toBe('general');
      expect(getHazardForMetric(null)).toBe('general');
    });

    it('fuses metrics of the same hazard into one group_key, different hazards into distinct keys', () => {
      const inputSpo2: FusionInput = {
        source: 'rule',
        ref_id: 'rule-spo2-1',
        crew_id: 'crew-01',
        hazard: 'respiratory',
        metric: 'spo2',
        severity: 'critical',
        status: 'active',
        raised_at: '2026-10-18T10:00:00Z',
        event_at: '2026-10-18T10:00:00Z',
        title: 'SpO2 Low',
        explanation: 'Low blood oxygen',
        mission_mode: 'mars',
      };

      const result1 = applyMemberEvent(null, inputSpo2, defaultOpts);
      expect(result1.state.group_key).toBe('crew-01:respiratory');
      expect(result1.state.members).toHaveLength(1);

      const inputResp: FusionInput = {
        source: 'rule',
        ref_id: 'rule-resp-1',
        crew_id: 'crew-01',
        hazard: 'respiratory',
        metric: 'resp_rate',
        severity: 'warning',
        status: 'active',
        raised_at: '2026-10-18T10:01:00Z',
        event_at: '2026-10-18T10:01:00Z',
        title: 'Resp Rate High',
        explanation: 'High respiration',
        mission_mode: 'mars',
      };

      const result2 = applyMemberEvent(result1.state, inputResp, defaultOpts);
      expect(result2.state.group_key).toBe('crew-01:respiratory');
      expect(result2.state.members).toHaveLength(2);
      expect(result2.state.metrics).toEqual(expect.arrayContaining(['spo2', 'resp_rate']));
    });
  });

  describe('Severity Calculation & Peak Severity', () => {
    it('selects highest active member severity and keeps peak_severity when worst member clears', () => {
      const input1: FusionInput = {
        source: 'rule',
        ref_id: 'r1',
        crew_id: 'crew-01',
        hazard: 'cardiovascular',
        metric: 'heart_rate',
        severity: 'warning',
        status: 'active',
        raised_at: '2026-10-18T10:00:00Z',
        event_at: '2026-10-18T10:00:00Z',
        title: 'Tachycardia',
        explanation: 'Heart rate high',
        mission_mode: 'mars',
      };

      const res1 = applyMemberEvent(null, input1, defaultOpts);
      expect(res1.state.severity).toBe('warning');
      expect(res1.state.peak_severity).toBe('warning');

      const input2: FusionInput = {
        source: 'rule',
        ref_id: 'r2',
        crew_id: 'crew-01',
        hazard: 'cardiovascular',
        metric: 'systolic',
        severity: 'critical',
        status: 'active',
        raised_at: '2026-10-18T10:01:00Z',
        event_at: '2026-10-18T10:01:00Z',
        title: 'Hypertension Crisis',
        explanation: 'Systolic critical',
        mission_mode: 'mars',
      };

      const res2 = applyMemberEvent(res1.state, input2, defaultOpts);
      expect(res2.state.severity).toBe('critical');
      expect(res2.state.peak_severity).toBe('critical');

      // Clear the critical member: severity should drop to warning, peak remains critical
      const input2Cleared: FusionInput = {
        ...input2,
        status: 'cleared',
        event_at: '2026-10-18T10:05:00Z',
      };

      const res3 = applyMemberEvent(res2.state, input2Cleared, defaultOpts);
      expect(res3.state.severity).toBe('warning');
      expect(res3.state.peak_severity).toBe('critical');
      expect(res3.state.condition).toBe('active');
    });
  });

  describe('Confidence Cap for ML Members', () => {
    it('caps low-confidence ML alert at watch when alone, and stores confidence_capped true', () => {
      const mlInput: FusionInput = {
        source: 'anomaly',
        ref_id: 'ml-01',
        crew_id: 'crew-01',
        hazard: 'cardiovascular',
        metric: 'heart_rate',
        severity: 'critical',
        status: 'active',
        confidence: 0.3, // below minConfidence 0.5
        raised_at: '2026-10-18T10:00:00Z',
        event_at: '2026-10-18T10:00:00Z',
        title: 'Arrhythmia Anomaly',
        explanation: 'Isolation forest detected potential arrhythmia',
        mission_mode: 'mars',
      };

      const res = applyMemberEvent(null, mlInput, defaultOpts);
      expect(res.state.severity).toBe('watch'); // capped
      const member = res.state.members[0];
      expect(member?.effective_severity).toBe('watch');
      expect(member?.confidence_capped).toBe(true);
    });

    it('lifts the confidence cap when corroborated by an active rule member', () => {
      const mlInput: FusionInput = {
        source: 'anomaly',
        ref_id: 'ml-01',
        crew_id: 'crew-01',
        hazard: 'cardiovascular',
        metric: 'heart_rate',
        severity: 'critical',
        status: 'active',
        confidence: 0.3,
        raised_at: '2026-10-18T10:00:00Z',
        event_at: '2026-10-18T10:00:00Z',
        title: 'Arrhythmia Anomaly',
        explanation: 'Isolation forest detected potential arrhythmia',
        mission_mode: 'mars',
      };

      const res1 = applyMemberEvent(null, mlInput, defaultOpts);
      expect(res1.state.severity).toBe('watch');

      const ruleInput: FusionInput = {
        source: 'rule',
        ref_id: 'rule-01',
        crew_id: 'crew-01',
        hazard: 'cardiovascular',
        metric: 'heart_rate',
        severity: 'warning',
        status: 'active',
        raised_at: '2026-10-18T10:01:00Z',
        event_at: '2026-10-18T10:01:00Z',
        title: 'Heart rate elevated',
        explanation: 'Rule alert',
        mission_mode: 'mars',
      };

      const res2 = applyMemberEvent(res1.state, ruleInput, defaultOpts);
      // Because active rule member corroborates the group, ML member's cap is lifted!
      // Its effective severity returns to critical, so fused severity becomes critical!
      expect(res2.state.severity).toBe('critical');
      const mlMember = res2.state.members.find((m) => m.source === 'anomaly');
      expect(mlMember?.confidence_capped).toBe(false);
      expect(mlMember?.effective_severity).toBe('critical');
    });
  });

  describe('Priority Matrix & Corroboration Bonus', () => {
    it('calculates base priority correctly: watch=10, warning=40, critical=80', () => {
      const pWatch = computePriority('watch', 'open', []);
      expect(pWatch.priority_score).toBe(10);
      expect(pWatch.priority_key).toBe(3010); // open weight = 3

      const pWarning = computePriority('warning', 'acknowledged', []);
      expect(pWarning.priority_score).toBe(40);
      expect(pWarning.priority_key).toBe(2040); // ack weight = 2

      const pCritical = computePriority('critical', 'snoozed', []);
      expect(pCritical.priority_score).toBe(80);
      expect(pCritical.priority_key).toBe(1080); // snoozed weight = 1
    });

    it('adds corroboration bonus: +10 per extra source, +5 per extra metric, capped at +20', () => {
      const members: FusedMember[] = [
        {
          source: 'rule',
          ref_id: 'r1',
          metric: 'spo2',
          severity: 'warning',
          effective_severity: 'warning',
          status: 'active',
          confidence_capped: false,
          raised_at: '2026-10-18T10:00:00Z',
          last_seen_at: '2026-10-18T10:00:00Z',
        },
        {
          source: 'anomaly',
          ref_id: 'a1',
          metric: 'resp_rate',
          severity: 'warning',
          effective_severity: 'warning',
          status: 'active',
          confidence_capped: false,
          raised_at: '2026-10-18T10:00:00Z',
          last_seen_at: '2026-10-18T10:00:00Z',
        },
      ];

      // 2 sources (+10) + 2 metrics (+5) = +15 bonus -> 40 + 15 = 55
      const p = computePriority('warning', 'open', members);
      expect(p.priority_score).toBe(55);
      expect(p.priority_key).toBe(3055);

      // Add a third source (risk) and third metric -> +20 (source) + 10 (metric) = 30 -> capped at +20
      members.push({
        source: 'risk',
        ref_id: 'rk1',
        metric: 'temp_c',
        severity: 'warning',
        effective_severity: 'warning',
        status: 'active',
        confidence_capped: false,
        raised_at: '2026-10-18T10:00:00Z',
        last_seen_at: '2026-10-18T10:00:00Z',
      });

      const pCapped = computePriority('warning', 'open', members);
      expect(pCapped.priority_score).toBe(60); // 40 + 20 cap = 60
    });
  });

  describe('Escalation Overrides Acknowledgment', () => {
    it('reopens acknowledged alert to open when a higher-severity member arrives', () => {
      const input1: FusionInput = {
        source: 'rule',
        ref_id: 'r1',
        crew_id: 'crew-01',
        hazard: 'thermal',
        metric: 'temp_c',
        severity: 'warning',
        status: 'active',
        raised_at: '2026-10-18T10:00:00Z',
        event_at: '2026-10-18T10:00:00Z',
        title: 'Mild Hyperthermia',
        explanation: 'Temp elevated',
        mission_mode: 'mars',
      };

      const res1 = applyMemberEvent(null, input1, defaultOpts);

      // Acknowledge the alert at warning severity
      const ackState = {
        ...res1.state,
        status: 'acknowledged' as const,
        severity_at_ack: 'warning' as const,
        acknowledged_at: '2026-10-18T10:02:00Z',
      };

      // New member of SAME severity does not reopen
      const sameSeverityInput: FusionInput = {
        source: 'anomaly',
        ref_id: 'ml1',
        crew_id: 'crew-01',
        hazard: 'thermal',
        metric: 'temp_c',
        severity: 'warning',
        status: 'active',
        confidence: 0.8,
        raised_at: '2026-10-18T10:03:00Z',
        event_at: '2026-10-18T10:03:00Z',
        title: 'Thermal Anomaly',
        explanation: 'Consistent hyperthermia',
        mission_mode: 'mars',
      };

      const resSame = applyMemberEvent(ackState, sameSeverityInput, defaultOpts);
      expect(resSame.state.status).toBe('acknowledged');

      // Member with HIGHER severity (critical) reopens to open!
      const critInput: FusionInput = {
        source: 'rule',
        ref_id: 'r2',
        crew_id: 'crew-01',
        hazard: 'thermal',
        metric: 'temp_c',
        severity: 'critical',
        status: 'active',
        raised_at: '2026-10-18T10:05:00Z',
        event_at: '2026-10-18T10:05:00Z',
        title: 'Severe Hyperthermia',
        explanation: 'Critically high temp',
        mission_mode: 'mars',
      };

      const resEsc = applyMemberEvent(resSame.state, critInput, defaultOpts);
      expect(resEsc.state.status).toBe('open');
      expect(resEsc.state.severity).toBe('critical');
      expect(resEsc.state.severity_at_ack).toBeUndefined();
      expect(resEsc.state.timeline.some((t) => t.type === 'escalated')).toBe(true);
    });
  });

  describe('Cleared Condition & Auto-Resolution', () => {
    it('leaves alert open when condition clears (does not vanish unseen)', () => {
      const input: FusionInput = {
        source: 'rule',
        ref_id: 'r1',
        crew_id: 'crew-01',
        hazard: 'respiratory',
        metric: 'spo2',
        severity: 'critical',
        status: 'active',
        raised_at: '2026-10-18T10:00:00Z',
        event_at: '2026-10-18T10:00:00Z',
        title: 'SpO2 Low',
        explanation: 'Hypoxia',
        mission_mode: 'mars',
      };

      const res1 = applyMemberEvent(null, input, defaultOpts);
      expect(res1.state.status).toBe('open');
      expect(res1.state.condition).toBe('active');

      // Clear the member
      const clearInput: FusionInput = {
        ...input,
        status: 'cleared',
        event_at: '2026-10-18T10:05:00Z',
      };

      const res2 = applyMemberEvent(res1.state, clearInput, defaultOpts);
      expect(res2.state.condition).toBe('cleared');
      expect(res2.state.status).toBe('open'); // stays open for human inspection!
      expect(res2.state.cleared_at).toBe('2026-10-18T10:05:00Z');
    });

    it('auto-resolves acknowledged+cleared alert with resolved_by system', () => {
      const input: FusionInput = {
        source: 'rule',
        ref_id: 'r1',
        crew_id: 'crew-01',
        hazard: 'respiratory',
        metric: 'spo2',
        severity: 'warning',
        status: 'active',
        raised_at: '2026-10-18T10:00:00Z',
        event_at: '2026-10-18T10:00:00Z',
        title: 'SpO2 Low',
        explanation: 'Hypoxia',
        mission_mode: 'mars',
      };

      const res1 = applyMemberEvent(null, input, defaultOpts);
      const ackState = {
        ...res1.state,
        status: 'acknowledged' as const,
        severity_at_ack: 'warning' as const,
      };

      // Clear the member
      const clearInput: FusionInput = {
        ...input,
        status: 'cleared',
        event_at: '2026-10-18T10:05:00Z',
      };

      const res2 = applyMemberEvent(ackState, clearInput, defaultOpts);
      expect(res2.state.condition).toBe('cleared');
      expect(res2.state.status).toBe('resolved');
      expect(res2.state.resolved_by).toBe('system');
      expect(res2.state.resolution).toBe('condition_cleared');
      expect(res2.state.timeline.some((t) => t.type === 'resolved')).toBe(true);
    });
  });

  describe('Dismissal Suppression', () => {
    it('suppresses incoming events of same or lower severity within the suppression window', () => {
      const dismissedAlert = {
        status: 'resolved' as const,
        resolution: 'dismissed',
        dismissed_severity: 'warning' as const,
        suppress_until: '2026-10-18T11:00:00Z',
      };

      const inputSame: FusionInput = {
        source: 'rule',
        ref_id: 'r1',
        crew_id: 'crew-01',
        hazard: 'thermal',
        severity: 'warning',
        status: 'active',
        raised_at: '2026-10-18T10:30:00Z',
        event_at: '2026-10-18T10:30:00Z',
        title: 'Temp Warning',
        explanation: 'Elevated temp',
        mission_mode: 'mars',
      };

      // Inside window, same severity -> suppressed
      expect(isSuppressedByDismissal(dismissedAlert, inputSame, '2026-10-18T10:30:00Z')).toBe(true);

      // Lower severity (watch) -> suppressed
      const inputWatch = { ...inputSame, severity: 'watch' as const };
      expect(isSuppressedByDismissal(dismissedAlert, inputWatch, '2026-10-18T10:30:00Z')).toBe(
        true,
      );

      // Higher severity (critical) -> NOT suppressed (creates new alert!)
      const inputCritical = { ...inputSame, severity: 'critical' as const };
      expect(isSuppressedByDismissal(dismissedAlert, inputCritical, '2026-10-18T10:30:00Z')).toBe(
        false,
      );

      // After window -> NOT suppressed
      expect(isSuppressedByDismissal(dismissedAlert, inputSame, '2026-10-18T11:00:01Z')).toBe(
        false,
      );
    });
  });

  describe('Member Cap & Pruning', () => {
    it('prunes oldest cleared members first and records dropped count', () => {
      const members: FusedMember[] = [
        {
          source: 'rule',
          ref_id: 'm1',
          severity: 'watch',
          effective_severity: 'watch',
          status: 'cleared',
          confidence_capped: false,
          raised_at: '2026-10-18T10:00:00Z',
          cleared_at: '2026-10-18T10:01:00Z',
          last_seen_at: '2026-10-18T10:01:00Z',
        },
        {
          source: 'rule',
          ref_id: 'm2',
          severity: 'watch',
          effective_severity: 'watch',
          status: 'cleared',
          confidence_capped: false,
          raised_at: '2026-10-18T10:02:00Z',
          cleared_at: '2026-10-18T10:03:00Z',
          last_seen_at: '2026-10-18T10:03:00Z',
        },
        {
          source: 'rule',
          ref_id: 'm3',
          severity: 'warning',
          effective_severity: 'warning',
          status: 'active',
          confidence_capped: false,
          raised_at: '2026-10-18T10:05:00Z',
          last_seen_at: '2026-10-18T10:05:00Z',
        },
      ];

      // Prune to 2 members: oldest cleared member (m1) should be dropped
      const pruned = pruneMembers(members, 2);
      expect(pruned.members).toHaveLength(2);
      expect(pruned.droppedCount).toBe(1);
      expect(pruned.members.map((m) => m.ref_id)).toEqual(['m3', 'm2']);
    });
  });

  describe('Adapters', () => {
    it('ruleAlertAdapter correctly converts AlertDTO', () => {
      const adapted = ruleAlertAdapter({
        type: 'alert.raised',
        alert: {
          id: 'alert-123',
          crew_id: 'crew-01',
          metric: 'spo2',
          value: 88,
          severity: 'critical',
          status: 'active',
          message: 'SpO2 critical',
          raised_at: '2026-10-18T10:00:00Z',
          mission_mode: 'mars',
        },
      });

      expect(adapted.source).toBe('rule');
      expect(adapted.ref_id).toBe('alert-123');
      expect(adapted.hazard).toBe('respiratory');
      expect(adapted.severity).toBe('critical');
      expect(adapted.status).toBe('active');
    });

    it('externalAlertAdapter correctly converts ExternalAlertInput', () => {
      const adapted = externalAlertAdapter({
        external_id: 'ext-99',
        source: 'anomaly',
        crew_id: 'crew-02',
        hazard: 'cardiovascular',
        metrics: ['heart_rate'],
        severity: 'warning',
        status: 'active',
        confidence: 0.88,
        model_id: 'iforest-v1',
        raised_at: '2026-10-18T10:00:00Z',
        explanation: 'Elevated anomaly score',
      });

      expect(adapted.source).toBe('anomaly');
      expect(adapted.ref_id).toBe('ext-99');
      expect(adapted.hazard).toBe('cardiovascular');
      expect(adapted.confidence).toBe(0.88);
      expect(adapted.model_id).toBe('iforest-v1');
    });
  });
});
