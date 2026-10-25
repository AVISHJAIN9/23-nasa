"""
Unit tests validating 24-hour diurnal circadian rhythm dynamics.
"""

from src.models.circadian import CircadianModel


def test_circadian_peak_and_nadir():
    """Validates that HR, temperature, and BP exhibit expected diurnal swings."""
    model = CircadianModel()

    nadir_offsets = model.get_offsets(hour_of_day=4.0)   # Early morning deep sleep
    peak_offsets = model.get_offsets(hour_of_day=16.0)   # Late afternoon peak

    # HR: Peak at 16:00, Nadir at 04:00
    assert peak_offsets["hr_offset"] > 5.0
    assert nadir_offsets["hr_offset"] < -5.0
    assert peak_offsets["hr_offset"] > nadir_offsets["hr_offset"]

    # Temp: Peak afternoon, Nadir early morning
    assert peak_offsets["temp_offset"] > 0.2
    assert nadir_offsets["temp_offset"] < -0.2

    # Blood Pressure nocturnal dipping
    assert peak_offsets["sys_offset"] > 0.0
    assert nadir_offsets["sys_offset"] < -5.0

    # HRV RMSSD: Higher during deep sleep (parasympathetic dominance)
    assert nadir_offsets["hrv_offset"] > peak_offsets["hrv_offset"]
    assert nadir_offsets["is_sleeping"] == 1.0
    assert peak_offsets["is_sleeping"] == 0.0
