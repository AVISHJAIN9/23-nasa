import { getHazardForMetric } from './hazards.js';
/**
 * Normalizes rule alert severity to the fusion severity scale ('watch' | 'warning' | 'critical').
 */
export function mapRuleSeverityToFused(severity) {
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
export function ruleAlertAdapter(event) {
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
        explanation: alert.message || `Rule threshold violation detected on ${alert.metric} (${alert.severity})`,
        confidence: 1.0,
        mission_mode: alert.mission_mode || 'mars',
        mission_day: alert.mission_day,
    };
}
/**
 * Maps an ExternalAlertInput into the unified FusionInput structure.
 */
export function externalAlertAdapter(input, defaultMissionMode = 'mars') {
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
