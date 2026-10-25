"""
Unit tests validating exercise cardiorespiratory kinetics.
"""

from src.models.exercise import ExerciseModel


def test_exercise_on_transient_and_recovery():
    """Validates exponential rise during exercise and smooth recovery post-exercise."""
    model = ExerciseModel(tau_on_s=30.0, tau_off_s=60.0)

    # 1. Step up workload to 80%
    states = []
    for _ in range(120):  # 2 minutes of exercise
        step = model.step(target_workload=0.8, dt_seconds=1.0)
        states.append(step)

    peak = states[-1]
    # Workload state approaches 0.8
    assert peak["workload_state"] > 0.75
    # HR rises significantly
    assert peak["delta_hr"] > 70.0
    # SBP rises
    assert peak["delta_sbp"] > 40.0
    # DBP drops slightly (vasodilation)
    assert peak["delta_dbp"] <= 0.0
    # Respiration increases
    assert peak["delta_resp"] > 15.0

    # 2. Recovery: workload steps down to 0.0
    recovery_states = []
    for _ in range(240):  # 4 minutes recovery
        step = model.step(target_workload=0.0, dt_seconds=1.0)
        recovery_states.append(step)

    recovered = recovery_states[-1]
    # Workload state decays back towards 0
    assert recovered["workload_state"] < 0.05
    assert recovered["delta_hr"] < 5.0
