import mongoose from 'mongoose';
import { ExternalAlert } from '../models/ExternalAlert.js';
import { CrewProfile } from '../models/CrewProfile.js';
import {
  type ExternalAlertsBatchBody,
  type ExternalAlertsResponse,
} from '../schemas/externalAlerts.js';
import { type FusionEngine } from './fusionEngine.js';
import { externalAlertAdapter } from './inputs.js';
import { isKnownHazard } from './hazards.js';
import { isKnownMetric } from '../telemetry/metrics.js';
import { type MissionMode } from '../bus/eventTypes.js';

/**
 * Sanitizes plain text from external ML sources by stripping HTML tags and trimming.
 */
export function sanitizePlainText(text: string, maxLength = 500): string {
  if (!text) return '';
  return text
    .replace(/<[^>]*>?/gm, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Processes an intake batch of external ML alerts.
 * Isolates per-item validation errors into rejected list while processing all valid items.
 */
export async function processExternalAlertsBatch(
  batch: ExternalAlertsBatchBody,
  fusionEngine: FusionEngine,
  defaultMissionMode: MissionMode = 'mars',
): Promise<ExternalAlertsResponse> {
  const rejected: Array<{ index: number; code: string; message: string }> = [];
  let accepted = 0;

  for (let i = 0; i < batch.alerts.length; i++) {
    const item = batch.alerts[i]!;

    // 1. Validate hazard
    if (!isKnownHazard(item.hazard)) {
      rejected.push({
        index: i,
        code: 'UNKNOWN_HAZARD',
        message: `Hazard "${item.hazard}" is not registered in the clinical hazard registry`,
      });
      continue;
    }

    // 2. Validate metrics if provided
    if (item.metrics && item.metrics.length > 0) {
      let metricInvalid = false;
      for (const m of item.metrics) {
        if (!isKnownMetric(m)) {
          rejected.push({
            index: i,
            code: 'UNKNOWN_METRIC',
            message: `Metric "${m}" is not registered in the telemetry METRICS catalog`,
          });
          metricInvalid = true;
          break;
        }
      }
      if (metricInvalid) continue;
    }

    // 3. Validate crew existence
    let crewExists = false;
    if (mongoose.Types.ObjectId.isValid(item.crew_id)) {
      crewExists = Boolean(
        await CrewProfile.exists({ _id: new mongoose.Types.ObjectId(item.crew_id) }),
      );
    }
    if (!crewExists) {
      crewExists = Boolean(await CrewProfile.exists({ callsign: item.crew_id }));
    }

    if (!crewExists) {
      rejected.push({
        index: i,
        code: 'CREW_NOT_FOUND',
        message: `Crew profile with id or callsign "${item.crew_id}" does not exist`,
      });
      continue;
    }

    // 4. Sanitize text fields
    const sanitizedExplanation = sanitizePlainText(item.explanation, 500);
    const sanitizedModelId = item.model_id ? sanitizePlainText(item.model_id, 100) : undefined;
    const sanitizedModelVersion = item.model_version
      ? sanitizePlainText(item.model_version, 50)
      : undefined;

    const sanitizedFactors = item.factors?.map((f) => ({
      name: sanitizePlainText(f.name, 100),
      direction: f.direction,
      contribution: f.contribution,
    }));

    const sanitizedItem = {
      ...item,
      explanation: sanitizedExplanation,
      model_id: sanitizedModelId,
      model_version: sanitizedModelVersion,
      factors: sanitizedFactors,
    };

    // 5. Upsert into external_alerts
    const existing = await ExternalAlert.findOne({
      source: sanitizedItem.source,
      external_id: sanitizedItem.external_id,
    });

    if (existing) {
      // Check if unchanged (repeat with identical content is a no-op)
      const unchanged =
        existing.status === sanitizedItem.status &&
        existing.severity === sanitizedItem.severity &&
        existing.confidence === sanitizedItem.confidence &&
        existing.explanation === sanitizedItem.explanation;

      if (!unchanged) {
        existing.status = sanitizedItem.status;
        existing.severity = sanitizedItem.severity;
        existing.confidence = sanitizedItem.confidence;
        existing.score = sanitizedItem.score;
        existing.explanation = sanitizedItem.explanation;
        existing.factors = sanitizedItem.factors;
        existing.event_at = sanitizedItem.event_at ?? sanitizedItem.raised_at;
        await existing.save();

        // Feed updated item into fusion
        const fusionInput = externalAlertAdapter(sanitizedItem, defaultMissionMode);
        await fusionEngine.processInput(fusionInput);
      }
    } else {
      await ExternalAlert.create({
        ...sanitizedItem,
        event_at: sanitizedItem.event_at ?? sanitizedItem.raised_at,
        mission_mode: sanitizedItem.mission_mode ?? defaultMissionMode,
      });

      // Feed new item into fusion
      const fusionInput = externalAlertAdapter(sanitizedItem, defaultMissionMode);
      await fusionEngine.processInput(fusionInput);
    }

    accepted += 1;
  }

  return {
    received: batch.alerts.length,
    accepted,
    rejected,
  };
}
