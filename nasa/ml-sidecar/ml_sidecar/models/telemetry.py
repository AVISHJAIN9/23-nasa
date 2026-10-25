"""
Telemetry models representing vital signs readings ingested by or passed to the ML sidecar.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class QualityInfo(BaseModel):
    flag: str = "ok"
    reasons: List[str] = Field(default_factory=list)


class TelemetryReading(BaseModel):
    crew_id: str
    metric: str
    value: Optional[float] = None
    unit: Optional[str] = None
    timestamp: str
    source: Optional[str] = "sensor"
    device_id: Optional[str] = None
    quality: Optional[QualityInfo] = None


class TelemetryBatch(BaseModel):
    batch_id: Optional[str] = None
    readings: List[TelemetryReading]
