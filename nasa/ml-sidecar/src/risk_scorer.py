"""
Early-Warning Risk Scorer for spaceflight astronaut vital signs monitoring.
Adapted from the Royal College of Physicians National Early Warning Score 2 (NEWS2),
extended with astronaut autonomic strain (HRV RMSSD) metrics.
"""

import math
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any

from .config import settings
from .models.alert import (
    SingleExternalAlert,
    ExternalAlertFactor,
    HazardType,
    SeverityType,
)
from .anomaly_detector import normalize_metric_name


def score_respiration_rate(rr: float) -> Tuple[int, str]:
    if rr <= 8.0:
        return 3, "down"
    elif rr <= 11.0:
        return 1, "down"
    elif rr <= 20.0:
        return 0, "normal"
    elif rr <= 24.0:
        return 2, "up"
    else:
        return 3, "up"


def score_spo2(spo2: float) -> Tuple[int, str]:
    if spo2 <= 91.0:
        return 3, "down"
    elif spo2 <= 93.0:
        return 2, "down"
    elif spo2 <= 95.0:
        return 1, "down"
    else:
        return 0, "normal"


def score_systolic(sys_bp: float) -> Tuple[int, str]:
    if sys_bp <= 90.0:
        return 3, "down"
    elif sys_bp <= 100.0:
        return 2, "down"
    elif sys_bp <= 110.0:
        return 1, "down"
    elif sys_bp <= 219.0:
        return 0, "normal"
    else:
        return 3, "up"


def score_heart_rate(hr: float) -> Tuple[int, str]:
    if hr <= 40.0:
        return 3, "down"
    elif hr <= 50.0:
        return 1, "down"
    elif hr <= 90.0:
        return 0, "normal"
    elif hr <= 110.0:
        return 1, "up"
    elif hr <= 130.0:
        return 2, "up"
    else:
        return 3, "up"


def score_temperature(temp: float) -> Tuple[int, str]:
    if temp <= 35.0:
        return 3, "down"
    elif temp <= 36.0:
        return 1, "down"
    elif temp <= 38.0:
        return 0, "normal"
    elif temp <= 39.0:
        return 1, "up"
    else:
        return 2, "up"


def score_hrv(hrv: float) -> Tuple[int, str]:
    if hrv < 15.0:
        return 2, "down"
    elif hrv < 25.0:
        return 1, "down"
    else:
        return 0, "normal"


class RiskScorer:
    """
    Computes spaceflight multi-vital early warning risk scores (NEWS2 adaptation).
    Generates structured risk alerts with clinical explanation factors.
    """

    def compute_risk(
        self,
        crew_id: str,
        vitals: Dict[str, float],
        timestamp: Optional[str] = None,
        mission_mode: Optional[str] = None,
        mission_day: Optional[int] = None,
    ) -> Tuple[int, Optional[SingleExternalAlert]]:
        """
        Computes the aggregate early-warning risk score.
        If score >= 3 (or any sub-score is 3), returns (total_score, SingleExternalAlert).
        Otherwise returns (total_score, None).
        """
        clean: Dict[str, float] = {}
        for k, v in vitals.items():
            if v is not None and not math.isnan(v):
                clean[normalize_metric_name(k)] = float(v)

        sub_scores: Dict[str, int] = {}
        sub_directions: Dict[str, str] = {}

        if "resp_rate" in clean:
            s, d = score_respiration_rate(clean["resp_rate"])
            sub_scores["resp_rate"] = s
            sub_directions["resp_rate"] = d

        if "spo2" in clean:
            s, d = score_spo2(clean["spo2"])
            sub_scores["spo2"] = s
            sub_directions["spo2"] = d

        if "systolic" in clean:
            s, d = score_systolic(clean["systolic"])
            sub_scores["systolic"] = s
            sub_directions["systolic"] = d

        if "heart_rate" in clean:
            s, d = score_heart_rate(clean["heart_rate"])
            sub_scores["heart_rate"] = s
            sub_directions["heart_rate"] = d

        if "temp_c" in clean:
            s, d = score_temperature(clean["temp_c"])
            sub_scores["temp_c"] = s
            sub_directions["temp_c"] = d

        if "hrv_rmssd" in clean:
            s, d = score_hrv(clean["hrv_rmssd"])
            sub_scores["hrv_rmssd"] = s
            sub_directions["hrv_rmssd"] = d

        # Check physiological exercise adaptation

        # In spaceflight sports medicine, exercise-induced tachycardia and tachypnea
        # are healthy adaptations when SpO2 >= 95% and SBP >= 115 mmHg.
        is_exercise = (
            clean.get("heart_rate", 0) > 100.0
            and clean.get("systolic", 0) >= 115.0
            and clean.get("spo2", 0) >= 95.0
            and clean.get("resp_rate", 0) >= 16.0
        )
        if is_exercise:
            sub_scores["heart_rate"] = 0
            sub_scores["resp_rate"] = 0

        total_score = sum(sub_scores.values())
        max_sub = max(sub_scores.values(), default=0)

        # Trigger alert if total >= 3 or any single parameter == 3

        if total_score < 3 and max_sub < 3:
            return total_score, None

        # Determine clinical severity
        if total_score >= 7 or max_sub >= 3 and total_score >= 5:
            severity: SeverityType = "critical"
        elif total_score >= 5 or max_sub >= 3:
            severity = "warning"
        else:
            severity = "watch"

        # Calculate explanation factors (max 5)
        contributing_scores = {k: s for k, s in sub_scores.items() if s > 0}
        total_contrib = sum(contributing_scores.values()) or 1.0

        factors: List[ExternalAlertFactor] = []
        for metric, score in contributing_scores.items():
            dir_val = sub_directions.get(metric, "up")
            factors.append(
                ExternalAlertFactor(
                    name=metric,
                    direction="down" if dir_val == "down" else "up",
                    contribution=round(score / total_contrib, 3),
                )
            )

        factors.sort(key=lambda f: f.contribution, reverse=True)
        top_factors = factors[:5]

        # Hazard determination
        hazard: HazardType = "general"
        if top_factors:
            primary = top_factors[0].name
            if primary in ("heart_rate", "systolic"):
                hazard = "cardiovascular"
            elif primary in ("spo2", "resp_rate"):
                hazard = "respiratory"
            elif primary == "temp_c":
                hazard = "thermal"
            elif primary == "hrv_rmssd":
                hazard = "autonomic_stress"

        raised_at = timestamp or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if not raised_at.endswith("Z"):
            raised_at += "Z"

        clinical_summary = ", ".join([f"{f.name} {f.direction} ({sub_scores.get(f.name, 0)} pts)" for f in top_factors[:3]])
        explanation = (
            f"Multi-vital NEWS2 risk score: {total_score} ({severity.upper()}). "
            f"Primary clinical risks: {clinical_summary}."
        )[:500]

        confidence = round(min(0.99, max(0.65, 0.60 + (total_score / 20.0))), 2)

        alert = SingleExternalAlert(
            external_id=f"risk-{crew_id[:8]}-{uuid.uuid4().hex[:12]}",
            source="risk",
            crew_id=crew_id,
            hazard=hazard,
            metrics=[f.name for f in top_factors],
            severity=severity,
            status="active",
            confidence=confidence,
            score=float(total_score),
            model_id=settings.model_id,
            model_version=settings.model_version,
            raised_at=raised_at,
            explanation=explanation,
            factors=top_factors,
            evidence={
                "vitals": clean,
                "sub_scores": sub_scores,
                "total_news2_score": total_score,
            },
            mission_mode=mission_mode,  # type: ignore
            mission_day=mission_day,
        )

        return total_score, alert


risk_scorer = RiskScorer()
