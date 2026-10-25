"""
Cabin environmental and hypercapnia (CO2) physiological response model.
References:
- Law et al. (2014) Relationship between carbon dioxide levels and reported headaches on the ISS. J Occup Environ Med.
- NASA STD-3001 Vol 2: Section 6.2 (Atmospheric Quality and Environmental Limits).
- West (2012) Respiratory Physiology: The Essentials.
"""

from typing import Dict


class EnvironmentModel:
    """
    Simulates physiological response to cabin environmental conditions, particularly
    elevated carbon dioxide (hypercapnia) from scrubber degradation, filter clogging,
    or localized pocketing in microgravity dead zones.
    """

    def __init__(
        self,
        nominal_co2_ppm: float = 3000.0,
        nominal_temp_c: float = 22.0,
        nominal_pressure_psi: float = 14.7,
    ):
        self.nominal_co2_ppm = nominal_co2_ppm
        self.nominal_temp_c = nominal_temp_c
        self.nominal_pressure_psi = nominal_pressure_psi

    def evaluate(
        self,
        co2_ppm: float = 3000.0,
        ambient_temp_c: float = 22.0,
        pressure_psi: float = 14.7,
    ) -> Dict[str, float]:
        """
        Computes physiological deltas resulting from ambient environmental exposure.
        """
        # CO2 excess above nominal spacecraft threshold (3,500 ppm / ~2.7 mmHg)
        co2_excess = max(0.0, co2_ppm - 3500.0)

        # 1. Hypercapnic ventilatory drive (medullary central chemoreceptor activation)
        # Respiration rate climbs linearly to blow off arterial CO2
        delta_resp = min(22.0, (co2_excess / 1000.0) * 2.8)

        # 2. Sympathetic response to hypercapnic acidosis
        # Elevation of heart rate and blood pressure
        delta_hr = min(25.0, (co2_excess / 1000.0) * 2.2)
        delta_sbp = min(30.0, (co2_excess / 1000.0) * 3.1)
        delta_dbp = min(18.0, (co2_excess / 1000.0) * 1.8)

        # 3. Autonomic stress from hypercapnia reduces HRV
        delta_hrv = -min(25.0, (co2_excess / 1000.0) * 3.0)

        # 4. SpO2 impact: under moderate CO2 rise, hyperventilation preserves oxygenation,
        # but at extreme levels (> 12,000 ppm) alveolar PO2 is diluted
        if co2_ppm > 10000.0:
            delta_spo2 = -min(4.0, ((co2_ppm - 10000.0) / 2000.0) * 1.5)
        else:
            delta_spo2 = 0.0

        # 5. Ambient temperature effect on core thermoregulation
        # Hot cabin (> 27 °C) causes cutaneous vasodilation (slight DBP drop, slight HR rise)
        temp_delta = ambient_temp_c - self.nominal_temp_c
        if temp_delta > 4.0:
            thermal_hr = (temp_delta - 4.0) * 1.2
            thermal_temp = (temp_delta - 4.0) * 0.06
        elif temp_delta < -4.0:
            thermal_hr = 0.0
            thermal_temp = (temp_delta + 4.0) * 0.05
        else:
            thermal_hr = 0.0
            thermal_temp = 0.0

        return {
            "co2_ppm": co2_ppm,
            "co2_excess": co2_excess,
            "delta_resp": delta_resp,
            "delta_hr": delta_hr + thermal_hr,
            "delta_sbp": delta_sbp,
            "delta_dbp": delta_dbp,
            "delta_spo2": delta_spo2,
            "delta_temp": thermal_temp,
            "delta_hrv": delta_hrv,
        }
