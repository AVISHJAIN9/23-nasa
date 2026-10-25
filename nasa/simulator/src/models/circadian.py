"""
Circadian rhythm model for core vitals.
References:
- Czeisler et al. (1999) Stability, precision, and near-24-hour period of the human circadian pacemaker. Science.
- Dijk et al. (2001) Sleep and circadian rhythms in spaceflight. Brain Res Rev.
- NASA STD-3001 Vol 1: Sleep and Circadian Shifting Standards.
"""

import math
from typing import Dict


class CircadianModel:
    """
    Computes 24-hour circadian phase offsets for core physiological variables.
    Simulates diurnal swings including nocturnal dipping of blood pressure,
    early-morning body temperature nadir, and autonomic vagal tone changes.
    """

    def __init__(self, cycle_period_hours: float = 24.0):
        self.period = cycle_period_hours

    def get_offsets(self, hour_of_day: float) -> Dict[str, float]:
        """
        Calculates additive/multiplicative offsets based on time of day in hours (0.0 to 24.0).

        Core timings:
        - Core temp nadir at ~04:30 (amplitude ~0.4 °C)
        - Heart rate nadir at ~04:00 (amplitude ~8.0 bpm)
        - Blood pressure dipping: nocturnal nadir at ~03:30 (SBP ~ -12 mmHg, DBP ~ -8 mmHg)
        - Respiration nadir at ~04:00 (amplitude ~1.5 breaths/min)
        - HRV RMSSD peak during deep slow-wave sleep (vagal tone) at ~03:30 (amplitude ~+18 ms)
        """
        t = hour_of_day % self.period
        two_pi = 2.0 * math.pi

        # Phase angles with peak offsets (cosine max occurs at phase = 0)
        # Peak HR at 16:00 (nadir at 04:00)
        phase_hr = (t - 16.0) * two_pi / self.period
        hr_offset = 7.0 * math.cos(phase_hr)

        # Peak Temp at 16:30 (nadir at 04:30)
        phase_temp = (t - 16.5) * two_pi / self.period
        temp_offset = 0.38 * math.cos(phase_temp)

        # Nocturnal BP dipping (peak around 15:30, nadir around 03:30)
        phase_bp = (t - 15.5) * two_pi / self.period
        sys_offset = 10.0 * math.cos(phase_bp)
        dia_offset = 6.5 * math.cos(phase_bp)

        # Respiration rate (peak 15:00, nadir 03:00)
        phase_resp = (t - 15.0) * two_pi / self.period
        resp_offset = 1.4 * math.cos(phase_resp)

        # HRV RMSSD (anti-phase: highest during deep sleep at 03:30, lowest during peak sympathetic tone at 15:30)
        phase_hrv = (t - 3.5) * two_pi / self.period
        hrv_offset = 14.0 * math.cos(phase_hrv)

        # Sleep state flag (typical astronaut sleep window: 22:30 to 06:30)
        is_sleeping = (t >= 22.5) or (t < 6.5)

        return {
            "hr_offset": hr_offset,
            "temp_offset": temp_offset,
            "sys_offset": sys_offset,
            "dia_offset": dia_offset,
            "resp_offset": resp_offset,
            "hrv_offset": hrv_offset,
            "is_sleeping": 1.0 if is_sleeping else 0.0,
        }
