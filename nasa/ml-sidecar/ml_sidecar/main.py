"""
FastAPI application for AstroCare ML Sidecar service.
Provides real-time inference, baseline computation, and evaluation endpoints.
"""

import sys
from pathlib import Path

# Ensure ML sidecar root and repo root are on sys.path
_ML_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _ML_DIR.parent
for _p in (_ML_DIR, _REPO_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from contextlib import asynccontextmanager
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, HTTPException, Header, Query
from pydantic import BaseModel, Field

from .config import settings


from .models.telemetry import TelemetryReading, TelemetryBatch
from .models.alert import SingleExternalAlert, ExternalAlertsResponse
from .models.baseline import (
    BaselineVitals,
    BaselineComputeRequest,
    BaselineComputeResponse,
)
from .baseline_service import baseline_service
from .anomaly_detector import anomaly_detector
from .risk_scorer import risk_scorer
from .alert_dispatcher import alert_dispatcher


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup actions
    yield
    # Shutdown actions


app = FastAPI(
    title="AstroCare ML Sidecar",
    description="Space-medicine AI decision-support: Dual-layer Anomaly Detection & Multi-vital Risk Scoring",
    version="1.0.0",
    lifespan=lifespan,
)


class InferRequest(BaseModel):
    crew_id: str
    vitals: Dict[str, float]
    timestamp: Optional[str] = None
    quality_flags: Optional[Dict[str, str]] = None
    dispatch_to_backend: bool = False
    mission_mode: Optional[str] = None
    mission_day: Optional[int] = None


class InferResponse(BaseModel):
    crew_id: str
    news2_score: int
    alerts: List[SingleExternalAlert]
    dispatched: Optional[ExternalAlertsResponse] = None


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "astrocare-ml-sidecar"
    model_id: str
    model_version: str
    backend_url: str


@app.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Service liveness and model metadata health check."""
    return HealthResponse(
        status="ok",
        service="astrocare-ml-sidecar",
        model_id=settings.model_id,
        model_version=settings.model_version,
        backend_url=settings.backend_url,
    )


@app.post("/infer", response_model=InferResponse)
def infer(req: InferRequest) -> InferResponse:
    """
    Performs real-time anomaly detection and NEWS2-adapted risk scoring on astronaut vitals.
    Optionally dispatches alerts to AstroCare backend.
    """
    alerts: List[SingleExternalAlert] = []

    # 1. Anomaly detection (Z-Score + Isolation Forest)
    anomaly_alert = anomaly_detector.detect_anomalies(
        crew_id=req.crew_id,
        vitals=req.vitals,
        timestamp=req.timestamp,
        quality_flags=req.quality_flags,
        mission_mode=req.mission_mode,
        mission_day=req.mission_day,
    )
    if anomaly_alert:
        alerts.append(anomaly_alert)

    # 2. Risk scoring (NEWS2 multi-vital early warning)
    news2_score, risk_alert = risk_scorer.compute_risk(
        crew_id=req.crew_id,
        vitals=req.vitals,
        timestamp=req.timestamp,
        mission_mode=req.mission_mode,
        mission_day=req.mission_day,
    )
    if risk_alert:
        alerts.append(risk_alert)

    # 3. Optional dispatch to backend
    dispatch_result: Optional[ExternalAlertsResponse] = None
    if req.dispatch_to_backend and alerts:
        dispatch_result = alert_dispatcher.post_batch(alerts)

    return InferResponse(
        crew_id=req.crew_id,
        news2_score=news2_score,
        alerts=alerts,
        dispatched=dispatch_result,
    )


@app.post("/baseline/compute", response_model=BaselineComputeResponse)
def compute_baseline(req: BaselineComputeRequest) -> BaselineComputeResponse:
    """
    Computes per-crew resting physiological baselines and synchronizes with backend.
    """
    return baseline_service.process_and_sync(
        crew_id=req.crew_id,
        readings=req.telemetry,
        write_to_backend=req.write_to_backend,
    )


@app.get("/baseline/{crew_id}", response_model=BaselineVitals)
def get_crew_baseline(crew_id: str) -> BaselineVitals:
    """Retrieves cached physiological baseline for crew member."""
    return baseline_service.get_cached_baseline(crew_id)


@app.post("/eval")
@app.get("/eval")
def trigger_evaluation():
    """
    Triggers the full evaluation harness across all 7 simulator scenarios.
    Outputs markdown table into docs/ML_EVALUATION.md and benchmark chart into docs/ml_eval_benchmark.png.
    """
    from ..eval.evaluate import run_full_evaluation
    results = run_full_evaluation()
    return {
        "status": "completed",
        "scenarios_evaluated": len(results),
        "results": [r.model_dump() for r in results],
        "markdown_report": "docs/ML_EVALUATION.md",
        "chart_image": "docs/ml_eval_benchmark.png",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ml-sidecar.src.main:app", host=settings.host, port=settings.port, reload=True)

