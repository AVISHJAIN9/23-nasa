"""
Unit tests validating that digital-twin output vitals conform to NASA STD-3001
and medical plausibility ranges under both nominal and extreme workloads.
"""

import pytest
from src.models.astronaut import AstronautProfile
from src.models.twin import DigitalTwin


def test_nominal_resting_vitals_within_normal_bounds():
    """Validates baseline resting vitals stay in nominal physiological limits."""
    twin = DigitalTwin(seed=101)
    vitals = twin.generate_step(
        dt_seconds=1.0,
        hour_of_day=12.0,
        mission_day=10.0,
        workload=0.0,
    )

    # NASA STD-3001 nominal resting limits
    assert 50.0 <= vitals["heart_rate"] <= 85.0
    assert 95.0 <= vitals["spo2"] <= 100.0
    assert 100.0 <= vitals["systolic"] <= 135.0
    assert 65.0 <= vitals["diastolic"] <= 88.0
    assert 36.2 <= vitals["temp_c"] <= 37.4
    assert 10.0 <= vitals["resp_rate"] <= 19.0
    assert 20.0 <= vitals["hrv_rmssd"] <= 85.0

    # Physiological coupling: SBP must strictly exceed DBP with pulse pressure >= 20 mmHg
    assert vitals["systolic"] >= vitals["diastolic"] + 20.0


def test_maximal_exercise_bounds():
    """Validates that peak exertion reaches elevated levels without violating physiological ceilings."""
    astronaut = AstronautProfile.create_mercer()
    twin = DigitalTwin(astronaut=astronaut, seed=202)

    # Warm up and step through 10 minutes of maximal exercise
    vitals = {}
    for _ in range(600):
        vitals = twin.generate_step(
            dt_seconds=1.0,
            hour_of_day=16.0,
            mission_day=20.0,
            workload=1.0,
        )

    # High workload vitals
    assert vitals["heart_rate"] > 140.0
    assert vitals["heart_rate"] <= astronaut.max_heart_rate + 5.0
    assert vitals["systolic"] > 150.0
    assert vitals["systolic"] < 230.0
    assert vitals["resp_rate"] > 25.0
    assert vitals["resp_rate"] < 55.0
    assert vitals["hrv_rmssd"] < 25.0  # vagal withdrawal


def test_cardiac_anomaly_triggers_hemodynamic_instability():
    """Validates that cardiac anomaly override produces realistic tachycardia and shock profile."""
    twin = DigitalTwin(seed=303)
    vitals = twin.generate_step(
        dt_seconds=1.0,
        hour_of_day=14.0,
        cardiac_anomaly=True,
    )

    assert vitals["heart_rate"] >= 150.0
    assert vitals["spo2"] < 93.0
    assert vitals["systolic"] < 100.0  # acute hypotension
    assert vitals["resp_rate"] > 22.0  # compensatory tachypnea
