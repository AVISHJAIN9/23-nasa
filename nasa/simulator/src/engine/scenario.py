"""
Scenario parser and timeline phase management.
Reads YAML scenario descriptions and determines active physiological drivers.
"""

from pathlib import Path
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
import yaml


class TimedSpike(BaseModel):
    time_s: float
    metric: str
    delta: float


class TimedDropout(BaseModel):
    start_s: float
    end_s: float
    metric: str


class ScenarioPhase(BaseModel):
    """A distinct time window in a simulation scenario."""
    name: str = "phase"
    start_s: float = 0.0
    end_s: float = 3600.0
    workload: float = 0.0          # 0.0 (rest) to 1.0 (max)
    co2_ppm: float = 3000.0        # ambient CO2
    ambient_temp_c: float = 22.0
    motion_intensity: float = 0.0
    cardiac_anomaly: bool = False
    spe_active: bool = False
    spe_rate_msv_per_hour: float = 0.0
    mission_day: Optional[float] = None


class Scenario(BaseModel):
    """Complete scripted simulation scenario."""
    name: str
    description: str = ""
    duration_seconds: float = Field(default=3600.0, ge=1.0)
    sampling_rate_hz: float = Field(default=1.0, gt=0.0)
    start_hour: float = Field(default=8.0, ge=0.0, le=24.0, description="Starting UTC hour of day")
    initial_mission_day: float = Field(default=42.0, ge=0.0)
    mission_day_speedup: float = Field(default=0.0, description="Simulate multi-sol advancement across seconds")
    phases: List[ScenarioPhase] = Field(default_factory=list)
    spikes: List[TimedSpike] = Field(default_factory=list)
    dropouts: List[TimedDropout] = Field(default_factory=list)

    def get_phase_at(self, time_s: float) -> ScenarioPhase:
        """Finds the active phase at given elapsed seconds."""
        for phase in self.phases:
            if phase.start_s <= time_s < phase.end_s:
                return phase
        # If past last phase, return last phase or fallback
        if self.phases:
            return self.phases[-1]
        return ScenarioPhase(start_s=0.0, end_s=self.duration_seconds)

    def get_active_dropouts_at(self, time_s: float) -> Dict[str, bool]:
        """Returns active dropouts at time_s."""
        active: Dict[str, bool] = {}
        for d in self.dropouts:
            if d.start_s <= time_s < d.end_s:
                active[d.metric] = True
        return active

    def get_active_spikes_at(self, time_s: float, dt: float) -> Dict[str, float]:
        """Returns spikes scheduled within [time_s, time_s + dt)."""
        active: Dict[str, float] = {}
        for sp in self.spikes:
            if time_s <= sp.time_s < (time_s + dt):
                active[sp.metric] = sp.delta
        return active


def load_scenario(path_or_name: str, scenarios_dir: Optional[str] = None) -> Scenario:
    """
    Loads a YAML scenario by absolute path or filename inside scenarios_dir.
    """
    path = Path(path_or_name)
    if not path.is_file():
        if scenarios_dir:
            candidate = Path(scenarios_dir) / path_or_name
            if not candidate.suffix:
                candidate = candidate.with_suffix(".yaml")
            if candidate.is_file():
                path = candidate
        if not path.is_file():
            # Try searching relative to repo root or simulator/scenarios
            local_scenarios = Path(__file__).resolve().parent.parent.parent / "scenarios" / path_or_name
            if not local_scenarios.suffix:
                local_scenarios = local_scenarios.with_suffix(".yaml")
            if local_scenarios.is_file():
                path = local_scenarios

    if not path.is_file():
        raise FileNotFoundError(f"Scenario file not found: {path_or_name}")

    with open(path, "r", encoding="utf-8") as f:
        data: Dict[str, Any] = yaml.safe_load(f)

    return Scenario(**data)
