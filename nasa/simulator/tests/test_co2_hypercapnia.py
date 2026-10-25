"""
Unit tests validating cabin hypercapnia (elevated CO2) response.
"""

from src.models.environment import EnvironmentModel


def test_co2_hypercapnia_ventilatory_drive():
    """Validates that CO2 elevation above threshold triggers tachypnea and sympathetic drive."""
    model = EnvironmentModel()

    nominal = model.evaluate(co2_ppm=2800.0)
    hypercapnic = model.evaluate(co2_ppm=8500.0)

    # At nominal 2,800 ppm (below 3,500 ppm threshold), excess is 0
    assert nominal["co2_excess"] == 0.0
    assert nominal["delta_resp"] == 0.0
    assert nominal["delta_hr"] == 0.0

    # At 8,500 ppm, significant hypercapnic stimulation
    assert hypercapnic["co2_excess"] == 5000.0
    assert hypercapnic["delta_resp"] > 10.0   # Tachypnea
    assert hypercapnic["delta_hr"] > 8.0     # Sympathetic HR rise
    assert hypercapnic["delta_sbp"] > 12.0   # Sympathetic SBP rise
    assert hypercapnic["delta_hrv"] < -10.0  # Autonomic stress
