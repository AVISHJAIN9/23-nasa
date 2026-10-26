import { z } from 'zod';
import { DEFAULT_QUALITY_CONFIGS } from './qualityConfig.js';
export const METRICS = {
    heart_rate: {
        name: 'heart_rate',
        unit: 'bpm',
        description: 'Heart pulse rate in beats per minute',
        qualityConfig: DEFAULT_QUALITY_CONFIGS['heart_rate'],
    },
    spo2: {
        name: 'spo2',
        unit: '%',
        description: 'Blood oxygen saturation percentage',
        qualityConfig: DEFAULT_QUALITY_CONFIGS['spo2'],
    },
    systolic: {
        name: 'systolic',
        unit: 'mmHg',
        description: 'Systolic blood pressure in millimeters of mercury',
        qualityConfig: DEFAULT_QUALITY_CONFIGS['systolic'],
    },
    diastolic: {
        name: 'diastolic',
        unit: 'mmHg',
        description: 'Diastolic blood pressure in millimeters of mercury',
        qualityConfig: DEFAULT_QUALITY_CONFIGS['diastolic'],
    },
    temp_c: {
        name: 'temp_c',
        unit: 'C',
        description: 'Core body temperature in degrees Celsius',
        qualityConfig: DEFAULT_QUALITY_CONFIGS['temp_c'],
    },
    resp_rate: {
        name: 'resp_rate',
        unit: 'breaths/min',
        description: 'Respiratory ventilation rate in breaths per minute',
        qualityConfig: DEFAULT_QUALITY_CONFIGS['resp_rate'],
    },
    hrv_rmssd: {
        name: 'hrv_rmssd',
        unit: 'ms',
        description: 'Heart rate variability root mean square of successive differences in milliseconds',
        qualityConfig: DEFAULT_QUALITY_CONFIGS['hrv_rmssd'],
    },
};
export const KNOWN_METRIC_NAMES = Object.keys(METRICS);
export const MetricNameEnum = z.enum(KNOWN_METRIC_NAMES);
export const SOURCES = ['simulated', 'replayed_dataset', 'real_device'];
export const SourceEnum = z.enum(SOURCES);
/**
 * Checks whether a string corresponds to a registered metric.
 */
export function isKnownMetric(name) {
    return name in METRICS;
}
/**
 * Retrieves the definition and quality settings for a metric.
 */
export function getMetricDefinition(name) {
    return METRICS[name];
}
