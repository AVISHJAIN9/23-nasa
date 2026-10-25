"""
Unit tests validating TelemetryApiClient, idempotency handling, and CLI command execution.
"""

import tempfile
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from src.client.api_client import TelemetryApiClient, IngestionResult
from src.cli import parse_args, run_simulation


def test_api_client_successful_post():
    """Validates that TelemetryApiClient formats payloads and processes 200 OK responses."""
    client = TelemetryApiClient(
        base_url="http://test-server:4000",
        api_key="secret-key-12345",
    )

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"Idempotency-Replayed": "false"}
    mock_resp.json.return_value = {
        "batch_id": "test-b01",
        "received": 2,
        "accepted": 2,
        "rejected": [],
        "quality": {"ok": 2, "flagged": 0, "by_flag": {"dropout": 0, "implausible": 0, "flatline": 0, "spike": 0, "interpolated": 0}},
    }

    sample_readings = [
        {
            "crew_id": "660e8400e29b41d4a7164466",
            "metric": "heart_rate",
            "value": 72.0,
            "unit": "bpm",
            "timestamp": "2026-10-18T12:00:00.000Z",
            "source": "simulated",
            "device_id": "ecg-lead-2",
            "mission_day": 42.0,
        }
    ]

    with patch.object(client.session, "post", return_value=mock_resp) as mock_post:
        result = client.post_batch(readings=sample_readings, batch_id="test-b01")

        assert result.status_code == 200
        assert result.accepted == 2
        assert not result.is_replayed
        assert mock_post.called

        # Verify headers sent
        call_kwargs = mock_post.call_args[1]
        assert call_kwargs["headers"]["X-Ingest-Key"] == "secret-key-12345"
        assert call_kwargs["json"]["batch_id"] == "test-b01"


def test_api_client_handles_idempotency_replay():
    """Validates detection of Idempotency-Replayed header."""
    client = TelemetryApiClient(base_url="http://test-server:4000")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"Idempotency-Replayed": "true"}
    mock_resp.json.return_value = {
        "batch_id": "test-b01",
        "received": 1,
        "accepted": 1,
        "rejected": [],
        "quality": {"ok": 1, "flagged": 0},
    }

    with patch.object(client.session, "post", return_value=mock_resp):
        result = client.post_batch(readings=[], batch_id="test-b01")
        assert result.status_code == 200
        assert result.is_replayed is True


def test_api_client_error_handling():
    """Validates structured error reporting on non-200 responses."""
    client = TelemetryApiClient(base_url="http://test-server:4000")

    mock_resp = MagicMock()
    mock_resp.status_code = 422
    mock_resp.json.return_value = {
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "Invalid metric value",
        }
    }

    with patch.object(client.session, "post", return_value=mock_resp):
        result = client.post_batch(readings=[], batch_id="err-b01")
        assert result.status_code == 422
        assert "VALIDATION_ERROR" in (result.error_message or "")


def test_cli_argument_parsing():
    """Validates default and customized argument parsing in CLI."""
    args = parse_args([
        "--scenario", "heavy_exercise",
        "--rate", "2.0",
        "--speed", "5.0",
        "--seed", "999",
        "--dry-run",
    ])

    assert args.scenario == "heavy_exercise"
    assert args.rate == 2.0
    assert args.speed == 5.0
    assert args.seed == 999
    assert args.dry_run is True


def test_cli_dry_run_with_output_file():
    """Validates that running CLI with --output produces valid JSON file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        out_file = Path(tmpdir) / "output.json"
        args = parse_args([
            "--scenario", "normal_day",
            "--duration", "5.0",
            "--dry-run",
            "--quiet",
            "--output", str(out_file),
            "--seed", "42",
        ])

        ret = run_simulation(args)
        assert ret == 0
        assert out_file.is_file()

        with open(out_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        assert isinstance(data, list)
        assert len(data) == 35  # 5 seconds * 7 metrics = 35 readings
        first = data[0]
        assert first["metric"] == "heart_rate"
        assert first["source"] == "simulated"


def test_api_client_hmac_signature():
    """Validates that TelemetryApiClient computes and attaches X-Telemetry-Signature."""
    hmac_key = "test-hmac-secret-123456"
    client = TelemetryApiClient(
        base_url="http://localhost:4000",
        api_key="ingest-key",
        hmac_secret=hmac_key,
    )

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {}
    mock_resp.json.return_value = {
        "batch_id": "hmac-b01",
        "received": 1,
        "accepted": 1,
        "rejected": [],
        "quality": {},
    }

    with patch.object(client.session, "post", return_value=mock_resp) as mock_post:
        res = client.post_batch(
            readings=[{"metric": "heart_rate", "value": 75}],
            batch_id="hmac-b01",
        )
        assert res.status_code == 200
        call_kwargs = mock_post.call_args[1]
        assert "X-Telemetry-Signature" in call_kwargs["headers"]
        sig = call_kwargs["headers"]["X-Telemetry-Signature"]
        assert len(sig) == 64  # SHA-256 hex digest length

