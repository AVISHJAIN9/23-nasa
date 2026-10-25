"""
Unit tests validating microgravity fluid shift and long-term cardiovascular deconditioning.
"""

from src.models.microgravity import MicrogravityModel


def test_microgravity_adaptation_timeline():
    """Validates cephalad fluid shift at Sol 1 and chronic deconditioning progression at Sol 60."""
    model = MicrogravityModel()

    sol_0 = model.evaluate(mission_day=0.0)
    sol_1 = model.evaluate(mission_day=1.5)
    sol_60 = model.evaluate(mission_day=60.0)

    # Day 1.5: acute cephalad fluid shift peaks
    assert sol_1["fluid_shift_intensity"] > 0.8
    assert sol_1["sbp_offset"] > 3.0  # transient central venous pressure / BP rise

    # Day 60: acute fluid shift has resolved, chronic deconditioning has set in
    assert sol_60["fluid_shift_intensity"] == 0.0
    assert sol_60["deconditioning_progress"] > 0.9
    assert sol_60["hr_offset"] > 7.0  # resting HR elevated to preserve cardiac output
    assert sol_60["hrv_offset"] < -4.0
