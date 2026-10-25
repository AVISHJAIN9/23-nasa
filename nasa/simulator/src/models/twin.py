"""
Composite DigitalTwin model combining all biological sub-models into unified telemetry readings.
References:
- NASA STD-3001 Vol 1 & 2: Human Performance and Space Medicine Standards.
- Guyton and Hall Textbook of Medical Physiology (14th Ed).
"""

import random
from typing import Dict, Optional
from datetime import datetime, timezone

from .astronaut import AstronautProfile
from .circadian import CircadianModel
from .exercise import ExerciseModel
from .microgravity import MicrogravityModel
from .environment import EnvironmentModel
from .radiation import RadiationModel
from .noise import SensorNoiseModel


class DigitalTwin:
    """
    Physiological Digital-Twin representing an astronaut in deep space.
    Integrates circadian biology, exercise kinetics, microgravity deconditioning,
    cabin environmental factors, radiation accrual, and sensor noise.
    """

    def __init__(
        self,
        astronaut: Optional[AstronautProfile] = None,
        seed: Optional[int] = 42,
    ):
        self.astronaut = astronaut or AstronautProfile.create_mercer()
        self.rng = random.Random(seed)

        # Instantiate component models
        self.circadian = CircadianModel(cycle_period_hours=24.0)
        self.exercise = ExerciseModel()
        self.microgravity = MicrogravityModel()
        self.environment = EnvironmentModel()
        self.radiation = RadiationModel()
        self.noise = SensorNoiseModel(rng=self.rng)

    def reset(self) -> None:
        """Resets dynamic model states."""
        self.exercise.reset()

    def generate_step(
        self,
        dt_seconds: float = 1.0,
        hour_of_day: float = 12.0,
        mission_day: float = 1.0,
        workload: float = 0.0,
        co2_ppm: float = 3000.0,
        ambient_temp_c: float = 22.0,
        motion_intensity: float = 0.0,
        dropouts: Optional[Dict[str, bool]] = None,
        spikes: Optional[Dict[str, float]] = None,
        cardiac_anomaly: bool = False,
        spe_active: bool = False,
        spe_rate_msv_per_hour: float = 0.0,
    ) -> Dict[str, Optional[float]]:
        """
        Advances the digital-twin simulation state by dt_seconds and calculates
        all physiological vitals with cross-system coupling and sensor artifacts.
        """
        # 1. Base astronaut values
        base_hr = self.astronaut.baseline_hr
        base_spo2 = self.astronaut.baseline_spo2
        base_sbp = self.astronaut.baseline_systolic
        base_dbp = self.astronaut.baseline_diastolic
        base_temp = self.astronaut.baseline_temp_c
        base_resp = self.astronaut.baseline_resp_rate
        base_hrv = self.astronaut.baseline_hrv_rmssd

        # 2. Circadian rhythm offsets
        circ = self.circadian.get_offsets(hour_of_day)

        # 3. Exercise response kinetics
        ex = self.exercise.step(target_workload=workload, dt_seconds=dt_seconds)

        # 4. Microgravity chronic and acute adaptation
        ug = self.microgravity.evaluate(mission_day=mission_day)

        # 5. Cabin environmental effects (CO2, cabin temp)
        env = self.environment.evaluate(
            co2_ppm=co2_ppm,
            ambient_temp_c=ambient_temp_c,
        )

        # 6. Radiation effects
        rad = self.radiation.evaluate(
            mission_day=mission_day,
            spe_active=spe_active,
            spe_rate_msv_per_hour=spe_rate_msv_per_hour,
        )

        # Sum component deltas
        hr = base_hr + circ["hr_offset"] + ex["delta_hr"] + ug["hr_offset"] + env["delta_hr"] + rad["acute_hr_offset"]
        spo2 = base_spo2 + ex["delta_spo2"] + env["delta_spo2"]
        sbp = base_sbp + circ["sys_offset"] + ex["delta_sbp"] + ug["sbp_offset"] + env["delta_sbp"]
        dbp = base_dbp + circ["dia_offset"] + ex["delta_dbp"] + ug["dbp_offset"] + env["delta_dbp"]
        temp_c = base_temp + circ["temp_offset"] + ex["delta_temp"] + ug["temp_offset"] + env["delta_temp"]
        resp_rate = base_resp + circ["resp_offset"] + ex["delta_resp"] + ug["resp_offset"] + env["delta_resp"]
        hrv_rmssd = base_hrv + circ["hrv_offset"] + ex["delta_hrv"] + ug["hrv_offset"] + env["delta_hrv"] + rad["acute_hrv_offset"]

        # 7. Cardiac anomaly / Arrhythmia override (for emergency / blackout scenarios)
        if cardiac_anomaly:
            # Acute onset supraventricular tachycardia with secondary hemodynamic collapse
            hr += 95.0          # climbs towards 160-185 bpm
            spo2 -= 8.0         # desaturates towards 89-91%
            sbp -= 35.0         # acute hypotension (cardiac output compromised)
            dbp -= 20.0
            resp_rate += 14.0   # compensatory tachypnea (hyperventilation from air hunger)
            hrv_rmssd = max(4.0, hrv_rmssd - 35.0)

        # 8. Physiological coupling safeguards (physiological reality checks)
        # Pulse pressure must be positive and physiological: SBP >= DBP + 18
        if sbp < dbp + 18.0:
            sbp = dbp + 18.0

        # Tanaka maximal heart rate ceiling
        max_hr = self.astronaut.max_heart_rate
        if not cardiac_anomaly:
            hr = min(max_hr, max(38.0, hr))
        else:
            hr = min(220.0, max(38.0, hr))

        spo2 = min(100.0, max(50.0, spo2))
        temp_c = min(42.5, max(32.0, temp_c))
        resp_rate = min(58.0, max(5.0, resp_rate))
        hrv_rmssd = max(2.0, hrv_rmssd)

        clean_vitals = {
            "heart_rate": hr,
            "spo2": spo2,
            "systolic": sbp,
            "diastolic": dbp,
            "temp_c": temp_c,
            "resp_rate": resp_rate,
            "hrv_rmssd": hrv_rmssd,
        }

        # 9. Apply sensor noise and artifacts
        noisy_vitals = self.noise.apply_noise(
            metrics=clean_vitals,
            motion_intensity=motion_intensity + (workload * 0.7),
            dropouts=dropouts,
            spikes=spikes,
        )

        return noisy_vitals
