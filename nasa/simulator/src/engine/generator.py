"""
Telemetry generator translating digital twin states into AstroCare API reading payloads.
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Iterator, Any

from ..models.twin import DigitalTwin
from ..models.astronaut import AstronautProfile
from .scenario import Scenario


METRIC_UNITS = {
    "heart_rate": "bpm",
    "spo2": "%",
    "systolic": "mmHg",
    "diastolic": "mmHg",
    "temp_c": "C",
    "resp_rate": "breaths/min",
    "hrv_rmssd": "ms",
}

METRIC_DEVICES = {
    "heart_rate": "ecg-lead-2",
    "spo2": "pulse-ox-01",
    "systolic": "nibb-arm-cuff",
    "diastolic": "nibb-arm-cuff",
    "temp_c": "core-temp-pill",
    "resp_rate": "chest-band-1",
    "hrv_rmssd": "ecg-lead-2",
}


class TelemetryGenerator:
    """
    Step-by-step generator for simulation telemetry.
    Produces batches of readings adhering to the AstroCare Ingestion API contract.
    """

    def __init__(
        self,
        scenario: Scenario,
        astronaut: Optional[AstronautProfile] = None,
        seed: Optional[int] = 42,
        start_time_utc: Optional[datetime] = None,
    ):
        self.scenario = scenario
        self.astronaut = astronaut or AstronautProfile.create_mercer()
        self.twin = DigitalTwin(astronaut=self.astronaut, seed=seed)

        # Baseline starting UTC time
        if start_time_utc:
            self.base_time = start_time_utc
        else:
            now = datetime.now(timezone.utc)
            # Align with scenario.start_hour
            self.base_time = datetime(
                year=now.year,
                month=now.month,
                day=now.day,
                hour=int(scenario.start_hour),
                minute=int((scenario.start_hour % 1) * 60),
                second=0,
                tzinfo=timezone.utc,
            )

        self.elapsed_s: float = 0.0

    def reset(self) -> None:
        """Resets elapsed time and internal twin state."""
        self.elapsed_s = 0.0
        self.twin.reset()

    def generate_timestep(self, dt: float) -> List[Dict[str, Any]]:
        """
        Advances the simulation by dt seconds and generates sensor readings for all 7 metrics.
        """
        # Current time and mission day calculation
        current_time = self.base_time + timedelta(seconds=self.elapsed_s)
        hour_of_day = (current_time.hour + current_time.minute / 60.0 + current_time.second / 3600.0) % 24.0

        mission_day = self.scenario.initial_mission_day
        if self.scenario.mission_day_speedup > 0:
            mission_day += self.elapsed_s * self.scenario.mission_day_speedup
        else:
            mission_day += self.elapsed_s / 86400.0

        # Query scenario drivers at current elapsed time
        phase = self.scenario.get_phase_at(self.elapsed_s)
        if phase.mission_day is not None:
            mission_day = phase.mission_day

        active_dropouts = self.scenario.get_active_dropouts_at(self.elapsed_s)
        active_spikes = self.scenario.get_active_spikes_at(self.elapsed_s, dt)

        # Advance digital twin
        vitals = self.twin.generate_step(
            dt_seconds=dt,
            hour_of_day=hour_of_day,
            mission_day=mission_day,
            workload=phase.workload,
            co2_ppm=phase.co2_ppm,
            ambient_temp_c=phase.ambient_temp_c,
            motion_intensity=phase.motion_intensity,
            dropouts=active_dropouts,
            spikes=active_spikes,
            cardiac_anomaly=phase.cardiac_anomaly,
            spe_active=phase.spe_active,
            spe_rate_msv_per_hour=phase.spe_rate_msv_per_hour,
        )

        iso_timestamp = current_time.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

        readings: List[Dict[str, Any]] = []
        for metric, value in vitals.items():
            readings.append({
                "crew_id": self.astronaut.crew_id,
                "metric": metric,
                "value": value,
                "unit": METRIC_UNITS.get(metric),
                "timestamp": iso_timestamp,
                "source": "simulated",
                "device_id": METRIC_DEVICES.get(metric, "bio-monitor-01"),
                "mission_day": round(mission_day, 2),
            })

        self.elapsed_s += dt
        return readings

    def stream_batches(
        self,
        batch_size: int = 35,
        max_duration_s: Optional[float] = None,
    ) -> Iterator[List[Dict[str, Any]]]:
        """
        Yields batches of readings until scenario duration (or max_duration_s) is reached.
        """
        target_duration = max_duration_s if max_duration_s is not None else self.scenario.duration_seconds
        dt = 1.0 / self.scenario.sampling_rate_hz

        current_batch: List[Dict[str, Any]] = []

        while self.elapsed_s < target_duration:
            step_readings = self.generate_timestep(dt)
            current_batch.extend(step_readings)

            if len(current_batch) >= batch_size:
                yield current_batch[:batch_size]
                current_batch = current_batch[batch_size:]

        if current_batch:
            yield current_batch
