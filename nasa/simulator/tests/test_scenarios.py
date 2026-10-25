"""
Unit tests validating that all 7 scripted YAML scenarios load and run correctly.
"""

from pathlib import Path
import pytest

from src.engine.scenario import load_scenario
from src.engine.generator import TelemetryGenerator


SCENARIOS = [
    "normal_day",
    "heavy_exercise",
    "co2_rise",
    "sensor_dropout",
    "spike_artifacts",
    "cardiac_event_during_blackout",
    "slow_degradation_over_days",
]


@pytest.mark.parametrize("scenario_name", SCENARIOS)
def test_scenario_execution(scenario_name: str):
    """Validates that each scripted scenario loads and produces valid telemetry batches."""
    scenario = load_scenario(scenario_name)
    assert scenario.name == scenario_name
    assert scenario.duration_seconds > 0.0

    generator = TelemetryGenerator(scenario=scenario, seed=555)

    # Generate first 3 batches (simulating 15 seconds)
    batches = []
    for batch in generator.stream_batches(batch_size=35, max_duration_s=15.0):
        batches.append(batch)
        if len(batches) >= 3:
            break

    assert len(batches) > 0
    first_batch = batches[0]
    assert len(first_batch) == 35

    # Check reading contract adherence
    for reading in first_batch:
        assert len(reading["crew_id"]) == 24
        assert reading["metric"] in [
            "heart_rate", "spo2", "systolic", "diastolic", "temp_c", "resp_rate", "hrv_rmssd"
        ]
        assert reading["source"] == "simulated"
        assert reading["timestamp"].endswith("Z")
        assert "device_id" in reading
        assert "mission_day" in reading
