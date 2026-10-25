"""
Astronaut baseline profile and physiological parameters.
References:
- NASA-STD-3001 Vol 1 & 2 (Space Flight Human-System Standard)
- Tanaka et al. (2001) Age-predicted maximal heart rate revisited (JACC)
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field


class AstronautProfile(BaseModel):
    """
    Individual astronaut physiological baseline and biometric attributes.
    """
    crew_id: str = Field(
        default="660e8400e29b41d4a7164466",
        description="24-character hexadecimal MongoDB ObjectId",
    )
    callsign: str = Field(default="Ares-Lead", description="Crew mission callsign")
    age: int = Field(default=40, ge=18, le=75, description="Age in years")
    sex: Literal["male", "female"] = Field(default="male", description="Biological sex")
    height_cm: float = Field(default=180.0, ge=140.0, le=210.0, description="Height in cm")
    weight_kg: float = Field(default=75.0, ge=45.0, le=120.0, description="Pre-flight body weight in kg")

    # Baseline vitals (resting, seated at 1G or adapted microgravity baseline)
    baseline_hr: float = Field(default=65.0, ge=40.0, le=95.0, description="Resting heart rate in bpm")
    baseline_spo2: float = Field(default=98.5, ge=93.0, le=100.0, description="Resting SpO2 percentage")
    baseline_systolic: float = Field(default=118.0, ge=90.0, le=140.0, description="Resting systolic BP in mmHg")
    baseline_diastolic: float = Field(default=76.0, ge=60.0, le=90.0, description="Resting diastolic BP in mmHg")
    baseline_temp_c: float = Field(default=36.8, ge=36.2, le=37.3, description="Resting core body temp in Celsius")
    baseline_resp_rate: float = Field(default=14.0, ge=8.0, le=20.0, description="Resting respiration rate in breaths/min")
    baseline_hrv_rmssd: float = Field(default=45.0, ge=15.0, le=120.0, description="Resting HRV RMSSD in ms")

    @property
    def max_heart_rate(self) -> float:
        """
        Tanaka formula for age-predicted maximal heart rate:
        HR_max = 208 - (0.7 * age)
        """
        return 208.0 - (0.7 * self.age)

    @property
    def vo2_max(self) -> float:
        """
        Estimated VO2 max (ml/kg/min) for flight-qualified astronaut.
        NASA standard requires high cardiovascular endurance (> 40 ml/kg/min).
        """
        base = 52.0 if self.sex == "male" else 46.0
        age_correction = max(0.0, (self.age - 25) * 0.35)
        return round(base - age_correction, 1)

    @classmethod
    def create_mercer(cls, crew_id: Optional[str] = None) -> "AstronautProfile":
        """Preset profile for Cmdr. Alex Mercer (Mission Commander)."""
        return cls(
            crew_id=crew_id or "660e8400e29b41d4a7164466",
            callsign="Ares-Lead",
            age=42,
            sex="male",
            height_cm=183.0,
            weight_kg=81.0,
            baseline_hr=62.0,
            baseline_spo2=98.5,
            baseline_systolic=116.0,
            baseline_diastolic=74.0,
            baseline_temp_c=36.7,
            baseline_resp_rate=13.0,
            baseline_hrv_rmssd=52.0,
        )

    @classmethod
    def create_chen(cls, crew_id: Optional[str] = None) -> "AstronautProfile":
        """Preset profile for Lt. Maya Chen (Crew Medical Officer)."""
        return cls(
            crew_id=crew_id or "660e8400e29b41d4a7164467",
            callsign="Ares-Medic",
            age=36,
            sex="female",
            height_cm=168.0,
            weight_kg=62.0,
            baseline_hr=68.0,
            baseline_spo2=99.0,
            baseline_systolic=112.0,
            baseline_diastolic=72.0,
            baseline_temp_c=36.8,
            baseline_resp_rate=14.5,
            baseline_hrv_rmssd=48.0,
        )
