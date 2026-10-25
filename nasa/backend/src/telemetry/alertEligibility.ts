import { type EvaluatedReading } from './qualityEvaluator.js';

/**
 * Determines whether a processed telemetry reading is eligible to trigger downstream alerts.
 *
 * SAFETY INVARIANT (F019 / Part 2b):
 * Only readings with a verified "ok" quality flag may trigger physiological threshold alerts.
 * Implausible readings, sensor dropouts, flatlines, spikes, or synthetic interpolations
 * must NOT trigger medical emergency alerts.
 */
export function isAlertEligible(reading: Pick<EvaluatedReading, 'quality'>): boolean {
  return reading.quality?.flag === 'ok';
}
