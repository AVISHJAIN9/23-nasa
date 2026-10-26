/**
 * Default quality thresholds and bounds for vital telemetry streams.
 *
 * NOTE FOR ML1 / MEDICAL EXPERT REVIEW:
 * Plausibility ranges represent physically possible sensor output bounds, NOT clinical alert thresholds.
 * For instance, an SpO2 of 60% represents severe hypoxemia but is still a valid physiological sensor measurement
 * and MUST receive an "ok" quality flag so downstream alert engines can trigger.
 * True sensor impossibilities (e.g. 0% or -999) are classified as "implausible".
 */
export const DEFAULT_QUALITY_CONFIGS = {
    heart_rate: {
        min_plausible: 20,
        max_plausible: 250,
        flatline_window_s: 15,
        flatline_epsilon: 0.01,
        max_rate_per_s: 25,
        level_shift_tolerance: 5,
    },
    spo2: {
        min_plausible: 50,
        max_plausible: 100,
        flatline_window_s: 30,
        flatline_epsilon: 0.1,
        max_rate_per_s: 5,
        level_shift_tolerance: 2,
    },
    systolic: {
        min_plausible: 50,
        max_plausible: 260,
        flatline_window_s: 60,
        flatline_epsilon: 0.5,
        max_rate_per_s: 40,
        level_shift_tolerance: 5,
    },
    diastolic: {
        min_plausible: 30,
        max_plausible: 160,
        flatline_window_s: 60,
        flatline_epsilon: 0.5,
        max_rate_per_s: 30,
        level_shift_tolerance: 5,
    },
    temp_c: {
        min_plausible: 30,
        max_plausible: 43,
        flatline_window_s: 120,
        flatline_epsilon: 0.02,
        max_rate_per_s: 0.5,
        level_shift_tolerance: 0.2,
    },
    resp_rate: {
        min_plausible: 4,
        max_plausible: 60,
        flatline_window_s: 30,
        flatline_epsilon: 0.1,
        max_rate_per_s: 10,
        level_shift_tolerance: 2,
    },
    hrv_rmssd: {
        min_plausible: 1,
        max_plausible: 300,
        flatline_window_s: 60,
        flatline_epsilon: 0.5,
        max_rate_per_s: 60,
        level_shift_tolerance: 5,
    },
};
