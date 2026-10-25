"""
Unit tests for per-crew baseline computation service.
"""

import sys
from pathlib import Path
import pytest
import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ML_DIR = REPO_ROOT / "ml-sidecar"
for p in (REPO_ROOT, ML_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from ml_sidecar.baseline_service import BaselineService, DEFAULT_NOMINAL_BASELINES
from ml_sidecar.models.telemetry import TelemetryReading, QualityInfo
from ml_sidecar.models.baseline import BaselineVitals


def test_baseline_computation_nominal_readings():
    service = BaselineService()

    # Generate 50 clean resting readings
    readings = []
    for _ in range(50):
        readings.append(
            TelemetryReading(
                crew_id="crew-101",
                metric="heart_rate",
                value=65.0 + float(np.random.normal(0, 2)),
                timestamp="2026-10-24T12:00:00Z",
                quality=QualityInfo(flag="ok"),
            )
        )
        readings.append(
            TelemetryReading(
                crew_id="crew-101",
                metric="spo2",
                value=98.5 + float(np.random.normal(0, 0.3)),
                timestamp="2026-10-24T12:00:00Z",
                quality=QualityInfo(flag="ok"),
            )
        )
        readings.append(
            TelemetryReading(
                crew_id="crew-101",
                metric="systolic",
                value=116.0 + float(np.random.normal(0, 3)),
                timestamp="2026-10-24T12:00:00Z",
                quality=QualityInfo(flag="ok"),
            )
        )

    computed = service.compute_from_readings(readings)
    assert 62.0 <= computed.resting_hr <= 68.0
    assert 97.5 <= computed.spo2 <= 99.5
    assert 112.0 <= computed.systolic <= 120.0


def test_baseline_ignores_degraded_and_missing_quality():
    service = BaselineService()

    readings = [
        # Valid readings
        TelemetryReading(crew_id="c1", metric="heart_rate", value=64.0, timestamp="2026-10-24T12:00:00Z", quality=QualityInfo(flag="ok")),
        TelemetryReading(crew_id="c1", metric="heart_rate", value=66.0, timestamp="2026-10-24T12:00:01Z", quality=QualityInfo(flag="ok")),
        TelemetryReading(crew_id="c1", metric="heart_rate", value=65.0, timestamp="2026-10-24T12:00:02Z", quality=QualityInfo(flag="ok")),
        TelemetryReading(crew_id="c1", metric="heart_rate", value=63.0, timestamp="2026-10-24T12:00:03Z", quality=QualityInfo(flag="ok")),
        TelemetryReading(crew_id="c1", metric="heart_rate", value=65.0, timestamp="2026-10-24T12:00:04Z", quality=QualityInfo(flag="ok")),
        # Degraded or extreme corrupted reading
        TelemetryReading(crew_id="c1", metric="heart_rate", value=220.0, timestamp="2026-10-24T12:00:05Z", quality=QualityInfo(flag="degraded")),
    ]

    computed = service.compute_from_readings(readings)
    # The 220.0 reading with flag='degraded' should be filtered out
    assert computed.resting_hr < 70.0


def test_baseline_fallback_to_defaults_on_sparse_data():
    service = BaselineService()

    # Only 2 readings (below min_samples_per_metric threshold of 5)
    readings = [
        TelemetryReading(crew_id="c2", metric="heart_rate", value=80.0, timestamp="2026-10-24T12:00:00Z", quality=QualityInfo(flag="ok")),
    ]

    computed = service.compute_from_readings(readings, min_samples_per_metric=5)
    # Falls back to nominal resting default (68.0)
    assert computed.resting_hr == DEFAULT_NOMINAL_BASELINES["resting_hr"]
    assert computed.spo2 == DEFAULT_NOMINAL_BASELINES["spo2"]


def test_cache_management():
    service = BaselineService()
    custom = BaselineVitals(resting_hr=58.0, spo2=99.0)
    service.set_cached_baseline("astro-42", custom)

    cached = service.get_cached_baseline("astro-42")
    assert cached.resting_hr == 58.0
    assert cached.spo2 == 99.0

    # Non-existent crew returns default nominal
    default_cached = service.get_cached_baseline("unknown-crew")
    assert default_cached.resting_hr == DEFAULT_NOMINAL_BASELINES["resting_hr"]
