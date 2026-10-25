"""
HTTP client for communicating with AstroCare Telemetry Ingestion API (F013 / F019).
"""

import uuid
import hmac
import hashlib
import json
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import requests


@dataclass
class IngestionResult:
    status_code: int
    batch_id: str
    received: int
    accepted: int
    rejected: List[Dict[str, Any]]
    quality: Dict[str, Any]
    error_message: Optional[str] = None
    is_replayed: bool = False


class TelemetryApiClient:
    """
    Sends telemetry batches to the AstroCare Ingest REST API over HTTP.
    Uses X-Ingest-Key machine authentication and batch_id idempotency.
    Optionally attaches X-Telemetry-Signature HMAC-SHA256 digest.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:4000",
        api_key: str = "dev_insecure_ingest_api_key_min_32_characters!",
        hmac_secret: Optional[str] = None,
        timeout_seconds: float = 10.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.hmac_secret = hmac_secret
        self.timeout = timeout_seconds
        self.session = requests.Session()

    def post_batch(
        self,
        readings: List[Dict[str, Any]],
        batch_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> IngestionResult:
        """
        Sends a single batch of telemetry readings to POST /v1/telemetry.
        """
        batch_id = batch_id or f"sim-batch-{uuid.uuid4().hex[:12]}"
        endpoint = f"{self.base_url}/v1/telemetry"

        headers = {
            "Content-Type": "application/json",
            "X-Ingest-Key": self.api_key,
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        payload = {
            "batch_id": batch_id,
            "readings": readings,
        }

        if self.hmac_secret:
            raw_json = json.dumps(payload, separators=(",", ":"))
            sig = hmac.new(
                self.hmac_secret.encode("utf-8"),
                raw_json.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            headers["X-Telemetry-Signature"] = sig

        try:
            resp = self.session.post(
                endpoint,
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
            is_replayed = resp.headers.get("Idempotency-Replayed", "false").lower() == "true"

            if resp.status_code == 200:
                body = resp.json()
                return IngestionResult(
                    status_code=200,
                    batch_id=batch_id,
                    received=body.get("received", len(readings)),
                    accepted=body.get("accepted", len(readings)),
                    rejected=body.get("rejected", []),
                    quality=body.get("quality", {}),
                    is_replayed=is_replayed,
                )
            else:
                try:
                    err_json = resp.json()
                    err_obj = err_json.get("error", {})
                    code = err_obj.get("code")
                    msg = err_obj.get("message", resp.text)
                    err_msg = f"[{code}] {msg}" if code else str(msg)
                except Exception:
                    err_msg = resp.text
                return IngestionResult(
                    status_code=resp.status_code,
                    batch_id=batch_id,
                    received=len(readings),
                    accepted=0,
                    rejected=[],
                    quality={},
                    error_message=f"HTTP {resp.status_code}: {err_msg}",
                    is_replayed=is_replayed,
                )
        except requests.RequestException as ex:
            return IngestionResult(
                status_code=0,
                batch_id=batch_id,
                received=len(readings),
                accepted=0,
                rejected=[],
                quality={},
                error_message=f"Network error: {str(ex)}",
            )
