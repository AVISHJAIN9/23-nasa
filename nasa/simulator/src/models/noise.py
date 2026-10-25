"""
Sensor noise, artifacts, spike, and dropout injection model.
Generates realistic bio-sensor noise characteristics and test artifacts.
"""

import random
from typing import Dict, Optional


class SensorNoiseModel:
    """
    Applies Gaussian measurement noise, motion artifacts, single-point rate-of-change spikes,
    flatlines, and sensor dropouts (None values).
    """

    # Base sensor Gaussian noise standard deviations
    NOISE_SIGMAS = {
        "heart_rate": 0.65,
        "spo2": 0.25,
        "systolic": 1.2,
        "diastolic": 0.9,
        "temp_c": 0.03,
        "resp_rate": 0.45,
        "hrv_rmssd": 1.5,
    }

    def __init__(self, rng: Optional[random.Random] = None):
        self.rng = rng or random.Random(42)

    def apply_noise(
        self,
        metrics: Dict[str, float],
        motion_intensity: float = 0.0,
        dropouts: Optional[Dict[str, bool]] = None,
        spikes: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Optional[float]]:
        """
        Applies measurement noise and artifacts to a dictionary of raw metric values.
        - motion_intensity: 0.0 (still) to 1.0 (vigorous motion artifacts).
        - dropouts: dict mapping metric name to bool (True -> value replaced with None).
        - spikes: dict mapping metric name to spike delta to add for current sample.
        """
        dropouts = dropouts or {}
        spikes = spikes or {}
        noisy_metrics: Dict[str, Optional[float]] = {}

        # Motion artifact multiplier: higher motion adds jitter and baseline drift
        motion_multiplier = 1.0 + (motion_intensity * 2.5)

        for name, value in metrics.items():
            # Check for active dropout (sensor disconnect / lead-off)
            if dropouts.get(name, False):
                noisy_metrics[name] = None
                continue

            sigma = self.NOISE_SIGMAS.get(name, 0.5) * motion_multiplier
            noise = self.rng.gauss(0.0, sigma)
            val = value + noise

            # Apply single-reading spike artifact if specified
            if name in spikes:
                val += spikes[name]

            # Sensor precision rounding
            if name in ("heart_rate", "systolic", "diastolic", "resp_rate", "hrv_rmssd"):
                val = round(val, 1)
            elif name == "temp_c":
                val = round(val, 2)
            elif name == "spo2":
                val = round(min(100.0, max(0.0, val)), 1)

            noisy_metrics[name] = val

        return noisy_metrics
