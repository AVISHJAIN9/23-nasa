"""
Microgravity adaptation model: Cephalad fluid shift and cardiovascular deconditioning.
References:
- Hargens & Richardson (2009) Cardiovascular adaptations, fluid shifts, and countermeasures. Respir Physiol Neurobiol.
- Norsk et al. (2015) Fluid shifts, vasodilatation and ambulatory blood pressure in space. J Physiol.
- Perhonen et al. (2001) Cardiac atrophy after bed rest and spaceflight. J Appl Physiol.
"""

import math
from typing import Dict


class MicrogravityModel:
    """
    Simulates physiological adaptation to microgravity across mission days:
    1. Acute cephalad fluid shift (Days 0-4): ~1.8L fluid relocation from legs to thorax/head,
       followed by compensatory diuresis and 10-15% plasma volume loss.
    2. Long-term cardiovascular deconditioning (Days 5-180+): decreased left ventricular stroke volume,
       gradual elevation of resting heart rate to maintain cardiac output, and baroreflex blunting.
    """

    def __init__(self):
        pass

    def evaluate(self, mission_day: float) -> Dict[str, float]:
        """
        Computes chronic physiological offsets for a given mission elapsed day (sol).
        """
        d = max(0.0, float(mission_day))

        # 1. Acute Cephalad Fluid Shift (peaks at day 1-2, resolves to new baseline by day 5)
        # Gamma-like curve: transient blood pressure elevation and nasal congestion
        if d < 10.0:
            fluid_shift_intensity = math.exp(-0.5 * ((d - 1.5) / 1.2) ** 2)
            acute_sbp_offset = 6.0 * fluid_shift_intensity
            acute_dbp_offset = 4.0 * fluid_shift_intensity
        else:
            fluid_shift_intensity = 0.0
            acute_sbp_offset = 0.0
            acute_dbp_offset = 0.0

        # 2. Chronic Cardiovascular Deconditioning (asymptote over ~30-45 days)
        # Left ventricular stroke volume drops ~10%; resting HR rises +8.5 bpm to preserve CO
        deconditioning_progress = 1.0 - math.exp(-d / 24.0)

        chronic_hr_offset = 9.0 * deconditioning_progress
        # Resting blood pressure settles slightly lower due to reduced stroke volume
        chronic_sbp_offset = -5.0 * deconditioning_progress
        chronic_dbp_offset = -2.5 * deconditioning_progress

        # HRV decreases slightly with prolonged deconditioning (reduced vagal reserve)
        chronic_hrv_offset = -6.0 * deconditioning_progress

        return {
            "mission_day": d,
            "fluid_shift_intensity": fluid_shift_intensity,
            "deconditioning_progress": deconditioning_progress,
            "hr_offset": chronic_hr_offset,
            "sbp_offset": acute_sbp_offset + chronic_sbp_offset,
            "dbp_offset": acute_dbp_offset + chronic_dbp_offset,
            "hrv_offset": chronic_hrv_offset,
            "resp_offset": 0.5 * deconditioning_progress,
            "temp_offset": 0.1 * deconditioning_progress,  # mild spaceflight-associated thermoregulation shift
        }
