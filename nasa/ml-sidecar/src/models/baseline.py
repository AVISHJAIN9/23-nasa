"""
Models for crew physiological baseline representation and computation.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from .telemetry import TelemetryReading


class BaselineVitals(BaseModel):
    resting_hr: Optional[float] = Field(default=None, ge=30.0, le=220.0)
    spo2: Optional[float] = Field(default=None, ge=70.0, le=100.0)
    systolic: Optional[float] = Field(default=None, ge=60.0, le=240.0)
    diastolic: Optional[float] = Field(default=None, ge=40.0, le=160.0)
    temp_c: Optional[float] = Field(default=None, ge=32.0, le=43.0)
    resp_rate: Optional[float] = Field(default=None, ge=6.0, le=50.0)
    hrv_rmssd: Optional[float] = Field(default=None, ge=0.0, le=300.0)


class CrewBaselineUpdateRequest(BaseModel):
    baseline: BaselineVitals


class BaselineComputeRequest(BaseModel):
    crew_id: str
    telemetry: Optional[List[TelemetryReading]] = None
    write_to_backend: bool = True


class BaselineComputeResponse(BaseModel):
    crew_id: str
    baseline: BaselineVitals
    samples_used: int
    written_to_backend: bool
    status: str = "ok"
    details: Optional[Dict[str, Any]] = None
