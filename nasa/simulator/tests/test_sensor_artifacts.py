"""
Unit tests validating sensor dropouts and spike artifact generation.
"""

import random
from src.models.noise import SensorNoiseModel


def test_dropout_injection():
    """Validates that active dropouts replace metric values with None."""
    noise_model = SensorNoiseModel(rng=random.Random(123))
    clean_vitals = {
        "heart_rate": 72.0,
        "spo2": 98.0,
        "systolic": 120.0,
        "diastolic": 78.0,
        "temp_c": 36.8,
        "resp_rate": 14.0,
        "hrv_rmssd": 45.0,
    }

    noisy = noise_model.apply_noise(
        metrics=clean_vitals,
        dropouts={"spo2": True, "resp_rate": True},
    )

    assert noisy["spo2"] is None
    assert noisy["resp_rate"] is None
    assert noisy["heart_rate"] is not None
    assert noisy["systolic"] is not None


def test_spike_injection():
    """Validates that scheduled spikes inject single-sample jumps."""
    noise_model = SensorNoiseModel(rng=random.Random(456))
    clean_vitals = {
        "heart_rate": 70.0,
        "spo2": 98.0,
        "systolic": 118.0,
        "diastolic": 76.0,
        "temp_c": 36.7,
        "resp_rate": 14.0,
        "hrv_rmssd": 50.0,
    }

    noisy = noise_model.apply_noise(
        metrics=clean_vitals,
        spikes={"heart_rate": 45.0, "systolic": 55.0},
    )

    # Base is ~70 + ~45 = ~115 (with Gaussian noise)
    assert noisy["heart_rate"] > 110.0
    # Base is ~118 + ~55 = ~173
    assert noisy["systolic"] > 165.0
