"""
Unit tests for AlertDispatcher (batching limit 100, X-ML-Key, rejected handling).
"""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ML_DIR = REPO_ROOT / "ml-sidecar"
for p in (REPO_ROOT, ML_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from ml_sidecar.alert_dispatcher import AlertDispatcher
from ml_sidecar.models.alert import SingleExternalAlert, ExternalAlertFactor


def _make_dummy_alert(i: int) -> SingleExternalAlert:
    return SingleExternalAlert(
        external_id=f"alert-{i}",
        source="anomaly",
        crew_id="crew-1",
        hazard="cardiovascular",
        severity="warning",
        status="active",
        confidence=0.85,
        raised_at="2026-10-24T12:00:00Z",
        explanation=f"Test alert explanation {i}",
        factors=[ExternalAlertFactor(name="heart_rate", direction="up", contribution=0.8)],
    )


def test_empty_alerts_returns_zero():
    dispatcher = AlertDispatcher()
    resp = dispatcher.post_batch([])
    assert resp.received == 0
    assert resp.accepted == 0
    assert len(resp.rejected) == 0


@patch("requests.post")
def test_batching_honors_100_item_limit(mock_post):
    mock_post.return_value = MagicMock(
        status_code=200,
        json=lambda: {"received": 100, "accepted": 100, "rejected": []},
    )

    dispatcher = AlertDispatcher()
    dispatcher.batch_limit = 100

    # 150 alerts should result in 2 HTTP calls (chunk 1: 100, chunk 2: 50)
    alerts = [_make_dummy_alert(i) for i in range(150)]

    def side_effect(url, json, headers, timeout):
        chunk_len = len(json["alerts"])
        assert chunk_len <= 100
        assert headers["X-ML-Key"] == dispatcher.api_key
        return MagicMock(
            status_code=200,
            json=lambda: {"received": chunk_len, "accepted": chunk_len, "rejected": []},
        )

    mock_post.side_effect = side_effect

    resp = dispatcher.post_batch(alerts)
    assert mock_post.call_count == 2
    assert resp.received == 150
    assert resp.accepted == 150
    assert len(resp.rejected) == 0


@patch("requests.post")
def test_handles_rejected_items_with_index_offset(mock_post):
    dispatcher = AlertDispatcher()
    dispatcher.batch_limit = 100

    # Create 110 alerts (chunk 1: 100, chunk 2: 10)
    alerts = [_make_dummy_alert(i) for i in range(110)]

    def side_effect(url, json, headers, timeout):
        chunk_len = len(json["alerts"])
        if chunk_len == 100:
            # Chunk 1: index 5 is rejected
            return MagicMock(
                status_code=200,
                json=lambda: {
                    "received": 100,
                    "accepted": 99,
                    "rejected": [{"index": 5, "code": "DUPLICATE", "message": "Duplicate external_id"}],
                },
            )
        else:
            # Chunk 2: index 2 in chunk (global index 102) is rejected
            return MagicMock(
                status_code=200,
                json=lambda: {
                    "received": 10,
                    "accepted": 9,
                    "rejected": [{"index": 2, "code": "INVALID_FACTOR", "message": "Factor error"}],
                },
            )

    mock_post.side_effect = side_effect

    resp = dispatcher.post_batch(alerts)
    assert resp.received == 110
    assert resp.accepted == 108
    assert len(resp.rejected) == 2

    # Global indices must be correctly offset
    assert resp.rejected[0].index == 5
    assert resp.rejected[0].code == "DUPLICATE"

    assert resp.rejected[1].index == 102
    assert resp.rejected[1].code == "INVALID_FACTOR"
