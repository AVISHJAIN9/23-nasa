"""
Unit tests for FastAPI endpoints in ML sidecar.
"""

import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ML_DIR = REPO_ROOT / "ml-sidecar"
for p in (REPO_ROOT, ML_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from ml_sidecar.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "astrocare-ml-sidecar"
    assert "model_version" in data


def test_infer_endpoint_nominal():
    payload = {
        "crew_id": "crew-api-test",
        "vitals": {
            "heart_rate": 68.0,
            "spo2": 98.5,
            "systolic": 118.0,
            "diastolic": 76.0,
            "temp_c": 36.6,
            "resp_rate": 14.0,
        },
        "dispatch_to_backend": False,
    }
    response = client.post("/infer", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["crew_id"] == "crew-api-test"
    assert data["news2_score"] == 0
    assert len(data["alerts"]) == 0


def test_infer_endpoint_severe_arrhythmia():
    payload = {
        "crew_id": "crew-api-arrhythmia",
        "vitals": {
            "heart_rate": 175.0,
            "spo2": 90.0,
            "systolic": 82.0,
            "diastolic": 50.0,
            "resp_rate": 26.0,
        },
        "dispatch_to_backend": False,
    }
    response = client.post("/infer", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["news2_score"] >= 7
    assert len(data["alerts"]) >= 1

    # Check alert structure adheres to schema
    alert = data["alerts"][0]
    assert alert["crew_id"] == "crew-api-arrhythmia"
    assert alert["severity"] in ("warning", "critical")
    assert "factors" in alert
    assert len(alert["factors"]) <= 5


def test_baseline_endpoints():
    compute_payload = {
        "crew_id": "crew-baseline-api",
        "write_to_backend": False,
        "telemetry": [
            {"crew_id": "crew-baseline-api", "metric": "heart_rate", "value": 62.0, "timestamp": "2026-10-24T12:00:00Z"},
            {"crew_id": "crew-baseline-api", "metric": "heart_rate", "value": 64.0, "timestamp": "2026-10-24T12:00:01Z"},
            {"crew_id": "crew-baseline-api", "metric": "heart_rate", "value": 63.0, "timestamp": "2026-10-24T12:00:02Z"},
            {"crew_id": "crew-baseline-api", "metric": "heart_rate", "value": 61.0, "timestamp": "2026-10-24T12:00:03Z"},
            {"crew_id": "crew-baseline-api", "metric": "heart_rate", "value": 62.0, "timestamp": "2026-10-24T12:00:04Z"},
        ],
    }

    res = client.post("/baseline/compute", json=compute_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["crew_id"] == "crew-baseline-api"
    assert data["baseline"]["resting_hr"] == 62.0

    # Retrieve cached baseline
    get_res = client.get("/baseline/crew-baseline-api")
    assert get_res.status_code == 200
    cached = get_res.json()
    assert cached["resting_hr"] == 62.0
