"""
Unit tests for spaceflight-adapted NEWS2 risk scorer.
"""

import sys
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ML_DIR = REPO_ROOT / "ml-sidecar"
for p in (REPO_ROOT, ML_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from ml_sidecar.risk_scorer import (
    RiskScorer,
    score_respiration_rate,
    score_spo2,
    score_systolic,
    score_heart_rate,
    score_temperature,
    score_hrv,
)


def test_news2_sub_scoring_functions():
    # Respiration Rate: <=8 (3), 9-11 (1), 12-20 (0), 21-24 (2), >=25 (3)
    assert score_respiration_rate(7.0) == (3, "down")
    assert score_respiration_rate(10.0) == (1, "down")
    assert score_respiration_rate(16.0) == (0, "normal")
    assert score_respiration_rate(22.0) == (2, "up")
    assert score_respiration_rate(28.0) == (3, "up")

    # SpO2: <=91 (3), 92-93 (2), 94-95 (1), >=96 (0)
    assert score_spo2(90.0) == (3, "down")
    assert score_spo2(93.0) == (2, "down")
    assert score_spo2(95.0) == (1, "down")
    assert score_spo2(98.0) == (0, "normal")

    # Systolic BP: <=90 (3), 91-100 (2), 101-110 (1), 111-219 (0), >=220 (3)
    assert score_systolic(85.0) == (3, "down")
    assert score_systolic(95.0) == (2, "down")
    assert score_systolic(105.0) == (1, "down")
    assert score_systolic(120.0) == (0, "normal")
    assert score_systolic(225.0) == (3, "up")

    # Heart Rate: <=40 (3), 41-50 (1), 51-90 (0), 91-110 (1), 111-130 (2), >=131 (3)
    assert score_heart_rate(38.0) == (3, "down")
    assert score_heart_rate(45.0) == (1, "down")
    assert score_heart_rate(72.0) == (0, "normal")
    assert score_heart_rate(102.0) == (1, "up")
    assert score_heart_rate(122.0) == (2, "up")
    assert score_heart_rate(142.0) == (3, "up")

    # Temperature: <=35.0 (3), 35.1-36.0 (1), 36.1-38.0 (0), 38.1-39.0 (1), >=39.1 (2)
    assert score_temperature(34.5) == (3, "down")
    assert score_temperature(35.5) == (1, "down")
    assert score_temperature(36.8) == (0, "normal")
    assert score_temperature(38.5) == (1, "up")
    assert score_temperature(39.5) == (2, "up")

    # Spaceflight HRV: <15 (2), 15-25 (1), >=25 (0)
    assert score_hrv(12.0) == (2, "down")
    assert score_hrv(20.0) == (1, "down")
    assert score_hrv(40.0) == (0, "normal")


def test_nominal_vitals_produce_score_zero_and_no_alert():
    scorer = RiskScorer()
    nominal = {
        "heart_rate": 65.0,
        "spo2": 98.0,
        "systolic": 118.0,
        "temp_c": 36.6,
        "resp_rate": 14.0,
        "hrv_rmssd": 45.0,
    }

    score, alert = scorer.compute_risk(crew_id="crew-norm", vitals=nominal)
    assert score == 0
    assert alert is None


def test_severe_deterioration_triggers_critical_risk_alert():
    scorer = RiskScorer()
    # High score: HR 140 (3), SpO2 90 (3), Systolic 85 (3), RR 26 (3) -> total 12
    severe_vitals = {
        "heart_rate": 140.0,
        "spo2": 90.0,
        "systolic": 85.0,
        "resp_rate": 26.0,
    }

    score, alert = scorer.compute_risk(crew_id="crew-critical", vitals=severe_vitals)
    assert score >= 7
    assert alert is not None
    assert alert.source == "risk"
    assert alert.severity == "critical"
    assert alert.status == "active"
    assert alert.score == float(score)
    assert alert.factors is not None
    assert len(alert.factors) <= 5
