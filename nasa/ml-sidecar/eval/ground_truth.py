"""
Ground truth clinical event definitions for simulator scenarios.
Enables quantitative benchmark computation: detection latency, false alarm rate, precision, and recall.
"""

from typing import Dict, List, Tuple, Optional
from pydantic import BaseModel


class ScenarioGroundTruth(BaseModel):
    scenario_name: str
    is_anomaly_scenario: bool
    event_onset_s: Optional[float] = None
    event_end_s: Optional[float] = None
    target_hazard: str = "general"
    description: str = ""

    def is_anomalous_at(self, time_s: float) -> bool:
        if not self.is_anomaly_scenario or self.event_onset_s is None:
            return False
        end = self.event_end_s if self.event_end_s is not None else float("inf")
        return self.event_onset_s <= time_s < end


SCENARIO_GROUND_TRUTH: Dict[str, ScenarioGroundTruth] = {
    "normal_day": ScenarioGroundTruth(
        scenario_name="normal_day",
        is_anomaly_scenario=False,
        target_hazard="general",
        description="Nominal diurnal astronaut baseline; ground truth is 100% nominal.",
    ),
    "heavy_exercise": ScenarioGroundTruth(
        scenario_name="heavy_exercise",
        is_anomaly_scenario=False,
        target_hazard="cardiovascular",
        description="High intensity exercise intervals (HIIT); physiological cardiovascular strain, not pathology.",
    ),
    "sensor_dropout": ScenarioGroundTruth(
        scenario_name="sensor_dropout",
        is_anomaly_scenario=False,
        target_hazard="general",
        description="Sensor transmission gap; technical sensor dropout, not physiological collapse.",
    ),
    "spike_artifacts": ScenarioGroundTruth(
        scenario_name="spike_artifacts",
        is_anomaly_scenario=False,
        target_hazard="general",
        description="Transient single-sample motion/EM noise spikes; rejected by filtering.",
    ),
    "cardiac_event_during_blackout": ScenarioGroundTruth(
        scenario_name="cardiac_event_during_blackout",
        is_anomaly_scenario=True,
        event_onset_s=600.0,
        event_end_s=2400.0,
        target_hazard="cardiovascular",
        description="Acute paroxysmal tachycardia with hemodynamic instability during comms blackout.",
    ),
    "co2_rise": ScenarioGroundTruth(
        scenario_name="co2_rise",
        is_anomaly_scenario=True,
        event_onset_s=1200.0,
        event_end_s=5100.0,
        target_hazard="respiratory",
        description="Environmental scrubber saturation producing respiratory hypercapnia.",
    ),
    "slow_degradation_over_days": ScenarioGroundTruth(
        scenario_name="slow_degradation_over_days",
        is_anomaly_scenario=True,
        event_onset_s=3600.0,
        event_end_s=5400.0,
        target_hazard="radiation",
        description="Mid-cruise solar particle event warning with chronic cardiovascular deconditioning.",
    ),
}
