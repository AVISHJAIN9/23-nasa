"""
Dual-layer physiological anomaly detector:
1. Rolling Z-Score vs Personal Baseline (univariate per vital)
2. Multi-vital Isolation Forest (multivariate physiological co-variance)
3. Factor attribution matching AstroCare ExternalAlert schema (direction, contribution <= 5).
"""

import math
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
from sklearn.ensemble import IsolationForest

from .config import settings
from .models.alert import (
    SingleExternalAlert,
    ExternalAlertFactor,
    HazardType,
    SeverityType,
)
from .models.baseline import BaselineVitals
from .baseline_service import (
    DEFAULT_NOMINAL_BASELINES,
    NOMINAL_STD_DEV,
    baseline_service,
)

METRIC_NAMES = [
    "heart_rate",
    "spo2",
    "systolic",
    "diastolic",
    "temp_c",
    "resp_rate",
    "hrv_rmssd",
]

# Alias map for metric name variations
METRIC_ALIASES: Dict[str, str] = {
    "hr": "heart_rate",
    "resting_hr": "heart_rate",
    "pulse": "heart_rate",
    "systolic_bp": "systolic",
    "diastolic_bp": "diastolic",
    "core_temperature": "temp_c",
    "temperature": "temp_c",
    "respiration_rate": "resp_rate",
    "respiratory_rate": "resp_rate",
    "rr": "resp_rate",
    "rmssd": "hrv_rmssd",
}


def normalize_metric_name(name: str) -> str:
    cleaned = name.lower().strip()
    return METRIC_ALIASES.get(cleaned, cleaned)


def train_initial_isolation_forest() -> IsolationForest:
    """
    Trains an IsolationForest model on synthetic nominal physiological vectors
    covering rest, mild-to-heavy exercise, and normal diurnal fluctuations.
    """
    rng = np.random.RandomState(42)
    n_samples = 2500

    # 1. Nominal resting cohort (60%)
    n_rest = int(n_samples * 0.6)
    hr_rest = rng.normal(68.0, 6.0, n_rest)
    spo2_rest = np.clip(rng.normal(98.5, 0.8, n_rest), 95.0, 100.0)
    sys_rest = rng.normal(118.0, 7.0, n_rest)
    dia_rest = rng.normal(76.0, 5.0, n_rest)
    temp_rest = rng.normal(36.6, 0.25, n_rest)
    rr_rest = rng.normal(14.0, 2.0, n_rest)
    hrv_rest = rng.normal(48.0, 10.0, n_rest)

    # 2. Exercise cohort (35%) - HR and RR elevate together, SBP rises, SpO2 stays high
    n_ex = int(n_samples * 0.35)
    workload = rng.uniform(0.2, 1.0, n_ex)
    hr_ex = 70.0 + workload * 85.0 + rng.normal(0, 4.0, n_ex)
    spo2_ex = np.clip(99.0 - workload * 1.5 + rng.normal(0, 0.5, n_ex), 94.0, 100.0)
    sys_ex = 120.0 + workload * 40.0 + rng.normal(0, 6.0, n_ex)
    dia_ex = 75.0 + workload * 5.0 + rng.normal(0, 4.0, n_ex)
    temp_ex = 36.6 + workload * 1.2 + rng.normal(0, 0.2, n_ex)
    rr_ex = 14.0 + workload * 18.0 + rng.normal(0, 2.5, n_ex)
    hrv_ex = np.clip(45.0 - workload * 28.0 + rng.normal(0, 3.0, n_ex), 10.0, 80.0)

    # 3. Mild diurnal fluctuations / sleep (5%)
    n_sleep = n_samples - n_rest - n_ex
    hr_sleep = rng.normal(54.0, 4.0, n_sleep)
    spo2_sleep = np.clip(rng.normal(97.5, 0.8, n_sleep), 94.0, 100.0)
    sys_sleep = rng.normal(108.0, 6.0, n_sleep)
    dia_sleep = rng.normal(68.0, 4.0, n_sleep)
    temp_sleep = rng.normal(36.2, 0.2, n_sleep)
    rr_sleep = rng.normal(12.0, 1.5, n_sleep)
    hrv_sleep = rng.normal(62.0, 12.0, n_sleep)

    X_nominal = np.column_stack([
        np.concatenate([hr_rest, hr_ex, hr_sleep]),
        np.concatenate([spo2_rest, spo2_ex, spo2_sleep]),
        np.concatenate([sys_rest, sys_ex, sys_sleep]),
        np.concatenate([dia_rest, dia_ex, dia_sleep]),
        np.concatenate([temp_rest, temp_ex, temp_sleep]),
        np.concatenate([rr_rest, rr_ex, rr_sleep]),
        np.concatenate([hrv_rest, hrv_ex, hrv_sleep]),
    ])

    iso_forest = IsolationForest(
        n_estimators=100,
        contamination=settings.iforest_contamination,
        random_state=42,
        n_jobs=1,
    )
    iso_forest.fit(X_nominal)
    return iso_forest


class RollingVitalBuffer:
    """Maintains a sliding window of historical readings per vital for rolling statistics."""

    def __init__(self, maxlen: int = 60):
        self.maxlen = maxlen
        self.buffers: Dict[str, deque] = {m: deque(maxlen=maxlen) for m in METRIC_NAMES}

    def append(self, metric: str, value: float) -> None:
        normalized = normalize_metric_name(metric)
        if normalized in self.buffers:
            self.buffers[normalized].append(value)

    def get_stats(self, metric: str) -> Tuple[float, float]:
        """Returns (rolling_mean, rolling_std). Defaults to nominal if insufficient samples."""
        normalized = normalize_metric_name(metric)
        buf = self.buffers.get(normalized, deque())
        if len(buf) < 5:
            default_mean = DEFAULT_NOMINAL_BASELINES.get(
                "resting_hr" if normalized == "heart_rate" else normalized, 70.0
            )
            default_std = NOMINAL_STD_DEV.get(
                "resting_hr" if normalized == "heart_rate" else normalized, 5.0
            )
            return default_mean, default_std

        arr = np.array(buf)
        return float(np.mean(arr)), max(float(np.std(arr)), 0.5)


class AnomalyDetector:
    """
    Combines Rolling Z-Score outlier detection against personal baselines
    with an Isolation Forest multi-vital model.
    """

    def __init__(
        self,
        z_threshold: Optional[float] = None,
        iso_forest: Optional[IsolationForest] = None,
    ):
        self.z_threshold = z_threshold or settings.z_score_threshold
        self.iso_forest = iso_forest or train_initial_isolation_forest()
        self._buffers: Dict[str, RollingVitalBuffer] = {}

    def _get_buffer(self, crew_id: str) -> RollingVitalBuffer:
        if crew_id not in self._buffers:
            self._buffers[crew_id] = RollingVitalBuffer(maxlen=settings.rolling_window_size)
        return self._buffers[crew_id]

    def _determine_hazard(self, dominant_factors: List[ExternalAlertFactor]) -> HazardType:
        """Maps dominant contributing vitals to standard HazardType."""
        if not dominant_factors:
            return "general"
        top_name = dominant_factors[0].name
        if top_name in ("heart_rate", "systolic", "diastolic", "systolic_bp", "diastolic_bp"):
            return "cardiovascular"
        elif top_name in ("spo2", "resp_rate", "respiration_rate"):
            return "respiratory"
        elif top_name in ("temp_c", "core_temperature"):
            return "thermal"
        elif top_name == "hrv_rmssd":
            return "autonomic_stress"
        return "general"

    def detect_anomalies(
        self,
        crew_id: str,
        vitals: Dict[str, float],
        timestamp: Optional[str] = None,
        quality_flags: Optional[Dict[str, str]] = None,
        baseline: Optional[BaselineVitals] = None,
        mission_mode: Optional[str] = None,
        mission_day: Optional[int] = None,
    ) -> Optional[SingleExternalAlert]:
        """
        Evaluates a set of vitals for anomalies.
        Returns a SingleExternalAlert matching AstroCare schema if anomalous, else None.
        """
        if not vitals:
            return None

        # Filter out readings flagged as degraded or missing
        clean_vitals: Dict[str, float] = {}
        for k, v in vitals.items():
            norm_k = normalize_metric_name(k)
            if quality_flags and quality_flags.get(k) not in (None, "ok", ""):
                continue
            if v is not None and not math.isnan(v):
                clean_vitals[norm_k] = float(v)

        if not clean_vitals:
            return None

        buf = self._get_buffer(crew_id)
        for k, v in clean_vitals.items():
            buf.append(k, v)

        # Retrieve personal baseline
        crew_baseline = baseline or baseline_service.get_cached_baseline(crew_id)
        base_dict = crew_baseline.model_dump(exclude_none=True)

        # 1. Compute univariate z-scores vs personal baseline
        z_scores: Dict[str, float] = {}
        directions: Dict[str, str] = {}
        anomalous_metrics: List[str] = []

        for metric in METRIC_NAMES:
            if metric not in clean_vitals:
                continue
            val = clean_vitals[metric]
            base_key = "resting_hr" if metric == "heart_rate" else metric
            mu = base_dict.get(base_key, DEFAULT_NOMINAL_BASELINES.get(base_key, 70.0))
            sigma = NOMINAL_STD_DEV.get(base_key, 5.0)

            z = (val - mu) / sigma
            z_scores[metric] = z
            directions[metric] = "up" if z >= 0 else "down"

            if abs(z) >= self.z_threshold:
                anomalous_metrics.append(metric)

        max_abs_z = max([abs(z) for z in z_scores.values()], default=0.0)
        # Fast exit optimization: if all vitals are within normal range, skip Isolation Forest
        if max_abs_z < 1.8:
            return None


        # 2. Multivariate Isolation Forest evaluation
        # Impute missing values with personal baseline
        vector: List[float] = []
        for metric in METRIC_NAMES:
            if metric in clean_vitals:
                vector.append(clean_vitals[metric])
            else:
                base_key = "resting_hr" if metric == "heart_rate" else metric
                vector.append(base_dict.get(base_key, DEFAULT_NOMINAL_BASELINES.get(base_key, 70.0)))

        X = np.array([vector])
        iforest_decision = float(self.iso_forest.decision_function(X)[0])
        is_iforest_anomaly = bool(self.iso_forest.predict(X)[0] == -1)

        # If decision is negative, it's in the anomaly zone
        raw_anomaly_score = 1.0 / (1.0 + math.exp(iforest_decision * 10.0))

        # Physiological Exercise Invariance:
        # Concordant exercise response: elevated HR + elevated SBP + elevated RR, but SpO2 >= 95%
        is_exercise_concordant = (
            clean_vitals.get("heart_rate", 0) > 100.0
            and clean_vitals.get("systolic", 0) >= 115.0
            and clean_vitals.get("spo2", 0) >= 95.0
            and clean_vitals.get("resp_rate", 0) >= 16.0
            and not is_iforest_anomaly
        )

        severe_univariate = max_abs_z >= 3.5 and not is_exercise_concordant
        multi_univariate = len(anomalous_metrics) >= 2 and not is_exercise_concordant
        multivariate_outlier = is_iforest_anomaly and max_abs_z >= 2.0

        is_anomalous = severe_univariate or multi_univariate or multivariate_outlier

        if not is_anomalous:
            return None


        # 3. Compute explanation factors (max 5)
        # Contribution is proportional to |z|
        total_abs_z = sum(abs(z) for z in z_scores.values()) or 1.0
        factor_items = []
        for m, z in z_scores.items():
            contrib = round(abs(z) / total_abs_z, 4)
            factor_items.append(
                ExternalAlertFactor(
                    name=m,
                    direction="up" if directions[m] == "up" else "down",
                    contribution=min(1.0, max(0.0, contrib)),
                )
            )

        factor_items.sort(key=lambda f: f.contribution, reverse=True)
        top_factors = factor_items[:5]

        # Normalize top factor contributions so they sum <= 1.0
        sum_top = sum(f.contribution for f in top_factors)
        if sum_top > 0:
            for f in top_factors:
                f.contribution = round(f.contribution / sum_top, 3)

        # 4. Determine severity and hazard
        hazard = self._determine_hazard(top_factors)
        if max_abs_z >= 4.5 or (is_iforest_anomaly and max_abs_z >= 3.5):
            severity: SeverityType = "critical"
        elif max_abs_z >= 3.0 or len(anomalous_metrics) >= 2:
            severity = "warning"
        else:
            severity = "watch"

        confidence = round(min(0.99, max(0.60, 0.5 + (max_abs_z / 10.0))), 2)
        raised_at = timestamp or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if not raised_at.endswith("Z"):
            raised_at += "Z"

        # Explanation string (<= 500 chars)
        primary = top_factors[0] if top_factors else None
        factor_desc = ", ".join(
            [f"{f.name} {f.direction} ({int(f.contribution * 100)}%)" for f in top_factors[:3]]
        )
        explanation = (
            f"Multi-vital physiological anomaly detected ({severity.upper()}). "
            f"Drivers: {factor_desc}. Max z-score: {max_abs_z:.1f} vs personal baseline."
        )[:500]

        evidence = {
            "vitals": clean_vitals,
            "z_scores": {k: round(v, 2) for k, v in z_scores.items()},
            "iforest_score": round(raw_anomaly_score, 3),
            "baseline": base_dict,
        }

        alert = SingleExternalAlert(
            external_id=f"anomaly-{crew_id[:8]}-{uuid.uuid4().hex[:12]}",
            source="anomaly",
            crew_id=crew_id,
            hazard=hazard,
            metrics=[f.name for f in top_factors],
            severity=severity,
            status="active",
            confidence=confidence,
            score=round(raw_anomaly_score, 4),
            model_id=settings.model_id,
            model_version=settings.model_version,
            raised_at=raised_at,
            explanation=explanation,
            factors=top_factors,
            evidence=evidence,
            mission_mode=mission_mode,  # type: ignore
            mission_day=mission_day,
        )
        return alert


anomaly_detector = AnomalyDetector()
