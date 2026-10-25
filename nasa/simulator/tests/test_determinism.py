"""
Unit tests validating that simulation output is 100% deterministic via --seed.
"""

from src.models.twin import DigitalTwin
from src.engine.scenario import Scenario, ScenarioPhase
from src.engine.generator import TelemetryGenerator


def test_seed_produces_identical_readings():
    """Validates that two simulations configured with the identical seed produce identical values."""
    scenario = Scenario(
        name="test_det",
        duration_seconds=60.0,
        phases=[ScenarioPhase(start_s=0.0, end_s=60.0, workload=0.4)],
    )

    gen1 = TelemetryGenerator(scenario=scenario, seed=777)
    gen2 = TelemetryGenerator(scenario=scenario, seed=777)

    readings1 = [batch for batch in gen1.stream_batches(batch_size=14, max_duration_s=60.0)]
    readings2 = [batch for batch in gen2.stream_batches(batch_size=14, max_duration_s=60.0)]

    assert len(readings1) == len(readings2)
    for b1, b2 in zip(readings1, readings2):
        assert len(b1) == len(b2)
        for r1, r2 in zip(b1, b2):
            assert r1["metric"] == r2["metric"]
            assert r1["value"] == r2["value"]
            assert r1["timestamp"] == r2["timestamp"]


def test_differing_seeds_produce_different_noise():
    """Validates that different seeds produce distinct stochastic variations."""
    twin_a = DigitalTwin(seed=111)
    twin_b = DigitalTwin(seed=999)

    vitals_a = twin_a.generate_step(dt_seconds=1.0, hour_of_day=12.0)
    vitals_b = twin_b.generate_step(dt_seconds=1.0, hour_of_day=12.0)

    # Base values should be close, but Gaussian noise makes exact values distinct
    assert vitals_a["heart_rate"] != vitals_b["heart_rate"]
    assert vitals_a["systolic"] != vitals_b["systolic"]
