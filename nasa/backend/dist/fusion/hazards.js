import { z } from 'zod';
/**
 * Registered clinical hazards for alert fusion (Part 2d).
 *
 * CLINICAL ASSUMPTION (Needs Medical Review & ML1 alignment):
 * - Cardiovascular: heart_rate, systolic, diastolic
 * - Respiratory: spo2, resp_rate
 * - Thermal: temp_c
 * - Autonomic Stress: hrv_rmssd
 * - Reserved for future modules: cabin_environment, radiation, general
 * Any unknown or unmapped metric falls back to 'general'.
 */
export const HAZARDS = [
    'respiratory',
    'cardiovascular',
    'thermal',
    'autonomic_stress',
    'cabin_environment',
    'radiation',
    'general',
];
export const HazardEnum = z.enum(HAZARDS);
/**
 * Metric to Hazard mapping table.
 */
export const METRIC_TO_HAZARD_MAP = {
    spo2: 'respiratory',
    resp_rate: 'respiratory',
    heart_rate: 'cardiovascular',
    systolic: 'cardiovascular',
    diastolic: 'cardiovascular',
    temp_c: 'thermal',
    hrv_rmssd: 'autonomic_stress',
};
/**
 * Resolves the hazard domain associated with a telemetry metric.
 * Unmapped metrics default to 'general'.
 */
export function getHazardForMetric(metric) {
    if (!metric)
        return 'general';
    return METRIC_TO_HAZARD_MAP[metric.toLowerCase()] ?? 'general';
}
/**
 * Validates if a string is a registered hazard.
 */
export function isKnownHazard(hazard) {
    return HAZARDS.includes(hazard);
}
