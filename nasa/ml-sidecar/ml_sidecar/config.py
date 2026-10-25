"""
Configuration settings for the AstroCare ML Sidecar service.
Supports environment variable overrides for containerized deployment.
"""

import os
from pydantic import BaseModel, Field


class Settings(BaseModel):
    backend_url: str = Field(
        default_factory=lambda: os.getenv("ASTRO_BACKEND_URL", "http://localhost:3000").rstrip("/")
    )
    ml_api_key: str = Field(
        default_factory=lambda: os.getenv(
            "ASTRO_ML_API_KEY", "dev_insecure_ml_api_key_min_32_characters!"
        )
    )
    host: str = Field(default_factory=lambda: os.getenv("HOST", "0.0.0.0"))
    port: int = Field(default_factory=lambda: int(os.getenv("PORT", "8000")))
    model_id: str = "astrocare-dual-ml"
    model_version: str = "1.0.0"
    batch_limit: int = 100
    z_score_threshold: float = 2.5
    iforest_contamination: float = 0.05
    rolling_window_size: int = 60


settings = Settings()
