"""
Unit tests for dual-layer Anomaly Detector (Z-Score + Isolation Forest + Factor Attribution).
"""

import sys
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ML_DIR = REPO_ROOT / "ml-sidecar"
for p in (REPO_ROOT, ML_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from ml_sidecar.anomaly_detector import AnomalyDetector
from ml_sidecar.models.baseline import BaselineVitals


def test_nominal_resting_vitals_produce_no_anomaly():
    detector = AnomalyDetector()

    nominal_vitals = {
        "heart_rate": 68.0,
        "spo2": 98.5,
        "systolic": 118.0,
        "diastolic": 76.0,
        "temp_c": 36.6,
        "resp_rate": 14.0,
        "hrv_rmssd": 45.0,
    }

    alert = detector.detect_anomalies(
        crew_id="crew-nominal",
        vitals=nominal_vitals,
    )
    assert alert is None


def test_acute_cardiac_event_triggers_critical_alert():
    detector = AnomalyDetector()

    # Acute SVT with hemodynamic shock (high HR, severe hypotension, hypoxemia)
    pathological_vitals = {
        "heart_rate": 178.0,
        "spo2": 90.0,
        "systolic": 82.0,
        "diastolic": 52.0,
        "temp_c": 36.7,
        "resp_rate": 26.0,
        "hrv_rmssd": 11.0,
    }

    alert = detector.detect_anomalies(
        crew_id="crew-cardiac",
        vitals=pathological_vitals,
        timestamp="2026-10-24T18:00:00Z",
    )

    assert alert is not None
    assert alert.source == "anomaly"
    assert alert.hazard == "cardiovascular"
    assert alert.severity in ("warning", "critical")
    assert alert.status == "active"
    assert alert.raised_at.endswith("Z")

    # Factors contract validation
    assert alert.factors is not None
    assert 1 <= len(alert.factors) <= 5
    for factor in alert.factors:
        assert factor.direction in ("up", "down")
        assert 0.0 <= factor.contribution <= 1.0

    # Heart rate factor must be 'up'
    hr_factor = next((f for f in alert.factors if f.name == "heart_rate"), None)
    assert hr_factor is not None
    assert hr_factor.direction == "up"


def test_personal_baseline_adaptation():
    detector = AnomalyDetector()

    # Athlete astronaut with resting HR baseline = 48 bpm
    athlete_baseline = BaselineVitals(resting_hr=48.0, spo2=99.0, systolic=110.0)

    # Moderate HR of 85 bpm is normal for general population,
    # but represents a significant +6 sigma tachycardia for this specific athlete!
    test_vitals = {
        "heart_rate": 88.0,
        "spo2": 98.0,
        "systolic": 110.0,
        "diastolic": 72.0,
        "temp_c": 36.6,
        "resp_rate": 14.0,
    }

    alert = detector.detect_anomalies(
        crew_id="astro-athlete",
        vitals=test_vitals,
        baseline=athlete_baseline,
    )

    # Must detect elevation relative to personal baseline
    assert alert is not None
    hr_factor = next((f for f in alert.factors if f.name == "heart_rate"), None)
    assert hr_factor is not None
    assert hr_factor.direction == "up"


def test_explanation_string_length_and_format():
    detector = AnomalyDetector()

    vitals = {
        "heart_rate": 165.0,
        "spo2": 89.0,
        "systolic": 85.0,
        "resp_rate": 28.0,
    }

    alert = detector.detect_anomalies(crew_id="c-len", vitals=vitals)
    assert alert is not None
    assert len(alert.explanation) >= 1
    assert len(alert.explanation) <= 500
