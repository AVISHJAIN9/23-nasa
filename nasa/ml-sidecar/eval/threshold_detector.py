"""
Plain threshold baseline detector for comparative benchmarking.
Uses standard static physiological limits without personalization or multivariate correlation.
"""

from typing import Dict, Optional, Tuple, List


class PlainThresholdDetector:
    """
    Standard static threshold comparator.
    Triggers an alert whenever any vital sign exceeds standard population limits.
    """

    THRESHOLDS = {
        "heart_rate": (50.0, 100.0),      # bpm
        "spo2": (94.0, 100.0),            # %
        "systolic": (90.0, 140.0),        # mmHg
        "diastolic": (60.0, 90.0),        # mmHg
        "temp_c": (36.0, 37.8),           # °C
        "resp_rate": (10.0, 20.0),        # breaths/min
    }

    def detect(self, vitals: Dict[str, float]) -> Tuple[bool, List[str]]:
        """
        Returns (is_alert, list_of_violated_metrics).
        """
        violations: List[str] = []
        for metric, (low, high) in self.THRESHOLDS.items():
            if metric in vitals:
                val = vitals[metric]
                if val is not None and (val < low or val > high):
                    violations.append(f"{metric}={val:.1f}")

        return len(violations) > 0, violations
