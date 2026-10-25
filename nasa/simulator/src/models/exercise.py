"""
Exercise response and cardiorespiratory kinetics model.
References:
- Whipp & Ward (1990) Physiological determinants of pulmonary gas exchange kinetics during exercise.
- Moore et al. (2014) Cardiovascular conditioning during spaceflight. NASA TM-2014-217384.
- Wasserman et al. Principles of Exercise Testing and Interpretation (5th Ed).
"""

from typing import Dict


class ExerciseModel:
    """
    Simulates dynamic cardiorespiratory response to physical exercise (e.g. cycle ergometer,
    treadmill, ARED resistance training) using first-order exponential kinetics.
    """

    def __init__(
        self,
        tau_on_s: float = 30.0,
        tau_off_s: float = 65.0,
        tau_temp_s: float = 480.0,
    ):
        self.tau_on = tau_on_s
        self.tau_off = tau_off_s
        self.tau_temp = tau_temp_s

        # Internal kinetic state variables (0.0 = resting, 1.0 = steady state peak)
        self.cardiorespiratory_state: float = 0.0
        self.thermal_state: float = 0.0

    def reset(self) -> None:
        """Resets dynamic exercise states to resting baseline."""
        self.cardiorespiratory_state = 0.0
        self.thermal_state = 0.0

    def step(self, target_workload: float, dt_seconds: float) -> Dict[str, float]:
        """
        Advances the exercise response state by dt_seconds towards target_workload.
        target_workload: 0.0 (rest) to 1.0 (VO2max exhaustion).
        """
        target = max(0.0, min(1.0, target_workload))

        # Dynamic tau: faster onset (tau_on) vs slower recovery decay (tau_off)
        if target > self.cardiorespiratory_state:
            tau = self.tau_on
        else:
            tau = self.tau_off

        # Update cardiorespiratory kinetic state: dS/dt = (Target - S) / tau
        alpha = min(1.0, dt_seconds / max(0.1, tau))
        self.cardiorespiratory_state += alpha * (target - self.cardiorespiratory_state)

        # Update thermal kinetic state (slower accumulation of metabolic heat)
        alpha_temp = min(1.0, dt_seconds / self.tau_temp)
        self.thermal_state += alpha_temp * (target - self.thermal_state)

        s = self.cardiorespiratory_state
        s_temp = self.thermal_state

        # Compute physiological deltas
        # HR delta: can add up to ~110 bpm at max effort
        delta_hr = s * 110.0

        # SBP increases with cardiac output (+20 to +65 mmHg)
        delta_sbp = s * 60.0

        # DBP stays flat or drops slightly (-4 to -8 mmHg) due to peripheral vasodilation
        delta_dbp = -s * 6.0

        # Respiration rate increases dramatically to blow off exercise CO2 (+18 to +28 bpm)
        delta_resp = s * 24.0

        # SpO2: slight physiological desaturation at peak exertion (down to -2.5%)
        delta_spo2 = - (s ** 2) * 2.2

        # Core temperature rises with prolonged heat production (+0.85 °C max)
        delta_temp = s_temp * 0.85

        # HRV RMSSD drops steeply due to sympathetic dominance (up to -32 ms)
        delta_hrv = -s * 30.0

        return {
            "workload_state": s,
            "delta_hr": delta_hr,
            "delta_sbp": delta_sbp,
            "delta_dbp": delta_dbp,
            "delta_resp": delta_resp,
            "delta_spo2": delta_spo2,
            "delta_temp": delta_temp,
            "delta_hrv": delta_hrv,
        }
