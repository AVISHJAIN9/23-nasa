import { type AlertDTO, type AlertEvent } from '../alerts/alertTypes.js';
import { type FusedSeverity, type FusionSource } from './fusionConfig.js';
import { type HazardName, getHazardForMetric } from './hazards.js';
import { type MissionMode } from '../bus/eventTypes.js';

export interface FusionFactor {
  name: string;
  direction: 'up' | 'down';
  contribution: number;
}

export interface FusionInput {
  source: FusionSource;
  ref_id: string;
  crew_id: string;
  hazard: HazardName;
  metric?: string;
  severity: FusedSeverity;
  status: 'active' | 'cleared';
  raised_at: string;
  event_at: string;
  title: string;
  explanation: string;
  confidence?: number;
  model_id?: string;
  model_version?: string;
  factors?: FusionFactor[];
  evidence?: Record<string, unknown>;
  mission_mode: MissionMode;
  mission_day?: number;
}

/**
 * Normalizes rule alert severity to the fusion severity scale ('watch' | 'warning' | 'critical').
 */
export function mapRuleSeverityToFused(severity: string): FusedSeverity {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'warning':
      return 'warning';
    case 'info':
    case 'watch':
    default:
      return 'watch';
  }
}

/**
 * Maps a Part 2b AlertDTO / AlertEvent into the unified FusionInput structure.
 */
export function ruleAlertAdapter(
  event: AlertEvent | { type: string; alert: AlertDTO },
): FusionInput {
  const { alert, type } = event;
  const isCleared = type === 'alert.cleared' || alert.status === 'cleared';
  const hazard = getHazardForMetric(alert.metric);

  return {
    source: 'rule',
    ref_id: alert.id,
    crew_id: alert.crew_id,
    hazard,
    metric: alert.metric,
    severity: mapRuleSeverityToFused(alert.severity),
    status: isCleared ? 'cleared' : 'active',
    raised_at: alert.raised_at,
    event_at: alert.cleared_at ?? alert.raised_at,
    title: alert.message || `Rule threshold violation on ${alert.metric}`,
    explanation:
      alert.message || `Rule threshold violation detected on ${alert.metric} (${alert.severity})`,
    confidence: 1.0,
    mission_mode: (alert.mission_mode as MissionMode) || 'mars',
    mission_day: alert.mission_day,
  };
}

/**
 * External alert intake format from Python ML services (anomaly / risk).
 */
export interface ExternalAlertInput {
  external_id: string;
  source: 'anomaly' | 'risk';
  crew_id: string;
  hazard: HazardName;
  metrics?: string[];
  severity: FusedSeverity;
  status: 'active' | 'cleared';
  confidence: number;
  score?: number;
  model_id?: string;
  model_version?: string;
  raised_at: string;
  event_at?: string;
  explanation: string;
  factors?: FusionFactor[];
  evidence?: Record<string, unknown>;
  mission_mode?: MissionMode;
  mission_day?: number;
}

/**
 * Maps an ExternalAlertInput into the unified FusionInput structure.
 */
export function externalAlertAdapter(
  input: ExternalAlertInput,
  defaultMissionMode: MissionMode = 'mars',
): FusionInput {
  return {
    source: input.source,
    ref_id: input.external_id,
    crew_id: input.crew_id,
    hazard: input.hazard,
    metric: input.metrics?.[0],
    severity: input.severity,
    status: input.status,
    confidence: input.confidence,
    model_id: input.model_id,
    model_version: input.model_version,
    raised_at: input.raised_at,
    event_at: input.event_at ?? input.raised_at,
    title: input.explanation
      ? input.explanation.slice(0, 80)
      : `${input.hazard} ${input.source} alert`,
    explanation: input.explanation,
    factors: input.factors ? input.factors.slice(0, 5) : undefined,
    evidence: input.evidence,
    mission_mode: input.mission_mode ?? defaultMissionMode,
    mission_day: input.mission_day,
  };
}
