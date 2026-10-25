"""
External alert models matching the AstroCare backend POST /v1/alerts/external contract.
"""

from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field


HazardType = Literal[
    "respiratory",
    "cardiovascular",
    "thermal",
    "autonomic_stress",
    "cabin_environment",
    "radiation",
    "general",
]

SeverityType = Literal["watch", "warning", "critical"]
SourceType = Literal["anomaly", "risk"]
StatusType = Literal["active", "cleared"]
DirectionType = Literal["up", "down"]
MissionModeType = Literal["iss", "moon", "mars"]


class ExternalAlertFactor(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    direction: DirectionType
    contribution: float = Field(ge=0.0, le=1.0)


class SingleExternalAlert(BaseModel):
    external_id: str = Field(min_length=1, max_length=100)
    source: SourceType
    crew_id: str = Field(min_length=1, max_length=100)
    hazard: HazardType
    metrics: Optional[List[str]] = None
    severity: SeverityType
    status: StatusType = "active"
    confidence: float = Field(ge=0.0, le=1.0)
    score: Optional[float] = None
    model_id: Optional[str] = Field(default=None, max_length=100)
    model_version: Optional[str] = Field(default=None, max_length=50)
    raised_at: str = Field(description="ISO 8601 UTC timestamp with Z")
    event_at: Optional[str] = None
    explanation: str = Field(min_length=1, max_length=500)
    factors: Optional[List[ExternalAlertFactor]] = Field(default=None, max_length=5)
    evidence: Optional[Dict[str, Any]] = None
    mission_mode: Optional[MissionModeType] = None
    mission_day: Optional[int] = None


class ExternalAlertsBatch(BaseModel):
    alerts: List[SingleExternalAlert] = Field(min_length=1, max_length=100)


class RejectedAlertItem(BaseModel):
    index: int
    code: str
    message: str


class ExternalAlertsResponse(BaseModel):
    received: int
    accepted: int
    rejected: List[RejectedAlertItem] = Field(default_factory=list)
