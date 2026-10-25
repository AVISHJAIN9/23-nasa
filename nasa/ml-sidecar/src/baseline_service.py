"""
Per-crew baseline computation service.
Computes robust resting physiological baselines from telemetry streams
and synchronizes with backend PUT /v1/crew/{id}/baseline.
"""

import logging
from typing import Dict, List, Optional, Any
import numpy as np
import requests

from .config import settings
from .models.telemetry import TelemetryReading
from .models.baseline import BaselineVitals, BaselineComputeResponse

logger = logging.getLogger("astrocare.ml.baseline")

# Default nominal physiological baselines for fallback
DEFAULT_NOMINAL_BASELINES: Dict[str, float] = {
    "resting_hr": 68.0,
    "spo2": 98.5,
    "systolic": 118.0,
    "diastolic": 76.0,
    "temp_c": 36.6,
    "resp_rate": 14.0,
    "hrv_rmssd": 45.0,
}

# Standard standard deviations in nominal resting population
NOMINAL_STD_DEV: Dict[str, float] = {
    "resting_hr": 6.5,
    "spo2": 1.2,
    "systolic": 7.5,
    "diastolic": 5.5,
    "temp_c": 0.35,
    "resp_rate": 2.2,
    "hrv_rmssd": 12.0,
}


class BaselineService:
    """Manages computation, caching, and backend synchronization of crew baselines."""

    def __init__(self, backend_url: Optional[str] = None, api_key: Optional[str] = None):
        self.backend_url = (backend_url or settings.backend_url).rstrip("/")
        self.api_key = api_key or settings.ml_api_key
        self._cache: Dict[str, BaselineVitals] = {}

    def get_cached_baseline(self, crew_id: str) -> BaselineVitals:
        """Returns cached baseline or nominal default if not yet computed."""
        if crew_id in self._cache:
            return self._cache[crew_id]
        return BaselineVitals(**DEFAULT_NOMINAL_BASELINES)

    def set_cached_baseline(self, crew_id: str, baseline: BaselineVitals) -> None:
        """Stores baseline in memory cache."""
        self._cache[crew_id] = baseline

    def compute_from_readings(
        self,
        readings: List[TelemetryReading],
        min_samples_per_metric: int = 5,
    ) -> BaselineVitals:
        """
        Computes robust resting physiological baseline from a collection of readings.
        Filters out degraded/critical quality readings and potential exercise spikes.
        """
        # Group clean values by metric
        grouped: Dict[str, List[float]] = {}
        for r in readings:
            if r.value is None or np.isnan(r.value):
                continue
            if r.quality and r.quality.flag not in ("ok", ""):
                continue

            metric = r.metric.lower().strip()
            # Normalize metric names if needed
            if metric == "heart_rate":
                metric = "resting_hr"
            elif metric == "systolic_bp":
                metric = "systolic"
            elif metric == "diastolic_bp":
                metric = "diastolic"
            elif metric == "core_temperature":
                metric = "temp_c"
            elif metric == "respiration_rate":
                metric = "resp_rate"

            if metric not in grouped:
                grouped[metric] = []
            grouped[metric].append(float(r.value))

        computed_vitals: Dict[str, float] = {}

        for metric_name, default_val in DEFAULT_NOMINAL_BASELINES.items():
            vals = grouped.get(metric_name, [])
            if len(vals) < min_samples_per_metric:
                computed_vitals[metric_name] = default_val
                continue

            arr = np.array(vals)

            # For resting heart rate and blood pressure, filter out top exertion percentiles
            # if we have sufficient samples (e.g. exercise periods should not skew resting baseline)
            if metric_name in ("resting_hr", "resp_rate", "systolic") and len(arr) >= 20:
                p25 = np.percentile(arr, 25)
                p75 = np.percentile(arr, 75)
                iqr = p75 - p25
                # Keep resting observations within [median - 1.5*iqr, median + 0.5*iqr]
                med = np.median(arr)
                filtered = arr[(arr >= med - 1.5 * iqr) & (arr <= med + 0.75 * iqr)]
                if len(filtered) >= min_samples_per_metric:
                    arr = filtered

            # Robust estimator: 10% trimmed mean or median
            robust_val = float(np.median(arr))

            # Apply physiological sanity bounds
            if metric_name == "resting_hr":
                robust_val = max(35.0, min(140.0, robust_val))
            elif metric_name == "spo2":
                robust_val = max(80.0, min(100.0, robust_val))
            elif metric_name == "systolic":
                robust_val = max(80.0, min(180.0, robust_val))
            elif metric_name == "diastolic":
                robust_val = max(50.0, min(120.0, robust_val))
            elif metric_name == "temp_c":
                robust_val = max(35.0, min(39.0, robust_val))
            elif metric_name == "resp_rate":
                robust_val = max(8.0, min(30.0, robust_val))
            elif metric_name == "hrv_rmssd":
                robust_val = max(5.0, min(200.0, robust_val))

            computed_vitals[metric_name] = round(robust_val, 2)

        return BaselineVitals(**computed_vitals)

    def write_to_backend(self, crew_id: str, baseline: BaselineVitals) -> Dict[str, Any]:
        """
        Sends the computed baseline to the backend via PUT /v1/crew/{id}/baseline
        with X-ML-Key authentication.
        """
        url = f"{self.backend_url}/v1/crew/{crew_id}/baseline"
        headers = {
            "X-ML-Key": self.api_key,
            "Content-Type": "application/json",
        }
        payload = baseline.model_dump(exclude_none=True)

        logger.info(f"Writing baseline for crew {crew_id} to backend at {url}")
        resp = requests.put(url, json=payload, headers=headers, timeout=10.0)

        if resp.status_code != 200:
            logger.error(
                f"Failed to write baseline to backend: HTTP {resp.status_code} - {resp.text}"
            )
            resp.raise_for_status()

        return resp.json()

    def process_and_sync(
        self,
        crew_id: str,
        readings: Optional[List[TelemetryReading]] = None,
        write_to_backend: bool = True,
    ) -> BaselineComputeResponse:
        """Computes baseline for crew member and optionally writes to backend."""
        sample_count = len(readings) if readings else 0
        if readings and sample_count > 0:
            baseline = self.compute_from_readings(readings)
        else:
            baseline = self.get_cached_baseline(crew_id)

        self.set_cached_baseline(crew_id, baseline)

        backend_resp = None
        written = False
        if write_to_backend:
            try:
                backend_resp = self.write_to_backend(crew_id, baseline)
                written = True
            except Exception as e:
                logger.warning(f"Could not sync baseline to backend: {e}")
                written = False

        return BaselineComputeResponse(
            crew_id=crew_id,
            baseline=baseline,
            samples_used=sample_count,
            written_to_backend=written,
            status="ok",
            details=backend_resp,
        )


baseline_service = BaselineService()
