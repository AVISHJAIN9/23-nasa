"""
Cumulative space radiation dose and acute event tracking model.
References:
- Cucinotta et al. (2013) Space radiation risks to the central nervous system. Life Sci Space Res.
- NASA STD-3001 Vol 1: Section 4.2 (Space Permissible Exposure Limits for Radiation).
- NCRP Report No. 153: Information for Space Radiation Protection.
"""

from typing import Dict


class RadiationModel:
    """
    Simulates cosmic radiation exposure (GCR background + Solar Particle Events)
    and tracks cumulative dose (mSv) across mission duration.
    """

    def __init__(self, background_rate_msv_per_day: float = 1.6):
        # Deep-space interplanetary cruise background (GCR): ~1.5 - 1.8 mSv/day
        self.background_rate_per_day = background_rate_msv_per_day
        self.cumulative_dose_msv: float = 0.0

    def evaluate(
        self,
        mission_day: float,
        spe_active: bool = False,
        spe_rate_msv_per_hour: float = 0.0,
    ) -> Dict[str, float]:
        """
        Computes current radiation rate and cumulative exposure.
        """
        d = max(0.0, float(mission_day))

        # Base accumulated dose from continuous GCR exposure
        base_accumulated = d * self.background_rate_per_day

        # Current dose rate in mSv/day
        current_rate_per_day = self.background_rate_per_day
        if spe_active and spe_rate_msv_per_hour > 0:
            current_rate_per_day += spe_rate_msv_per_hour * 24.0

        total_dose = base_accumulated + self.cumulative_dose_msv

        # Autonomic/physiological distress only under severe acute exposure (> 200 mSv)
        if current_rate_per_day > 100.0:
            # Acute radiation sickness prodromal response (mild nausea, autonomic strain)
            acute_hr_offset = 5.0
            acute_hrv_offset = -8.0
        else:
            acute_hr_offset = 0.0
            acute_hrv_offset = 0.0

        return {
            "current_rate_msv_day": current_rate_per_day,
            "cumulative_dose_msv": total_dose,
            "acute_hr_offset": acute_hr_offset,
            "acute_hrv_offset": acute_hrv_offset,
        }
