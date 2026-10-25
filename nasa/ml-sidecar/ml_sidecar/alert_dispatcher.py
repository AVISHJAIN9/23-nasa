"""
Alert dispatcher posting generated ML alerts to the AstroCare backend.
Honors the batch limit of 100 items, uses X-ML-Key authentication,
and parses / handles rejected items from the response.
"""

import logging
from typing import List, Dict, Any, Optional
import requests

from .config import settings
from .models.alert import (
    SingleExternalAlert,
    ExternalAlertsBatch,
    ExternalAlertsResponse,
    RejectedAlertItem,
)

logger = logging.getLogger("astrocare.ml.dispatcher")


class AlertDispatcher:
    """Dispatches batches of ExternalAlerts to POST /v1/alerts/external."""

    def __init__(self, backend_url: Optional[str] = None, api_key: Optional[str] = None):
        self.backend_url = (backend_url or settings.backend_url).rstrip("/")
        self.api_key = api_key or settings.ml_api_key
        self.batch_limit = settings.batch_limit

    def post_batch(self, alerts: List[SingleExternalAlert]) -> ExternalAlertsResponse:
        """
        Posts a list of alerts to the backend, splitting into chunks if len > batch_limit (100).
        Aggregates results and returns overall ExternalAlertsResponse.
        """
        if not alerts:
            return ExternalAlertsResponse(received=0, accepted=0, rejected=[])

        total_received = 0
        total_accepted = 0
        all_rejected: List[RejectedAlertItem] = []

        url = f"{self.backend_url}/v1/alerts/external"
        headers = {
            "X-ML-Key": self.api_key,
            "Content-Type": "application/json",
        }

        # Chunk alerts to respect backend maximum batch size of 100
        for chunk_start in range(0, len(alerts), self.batch_limit):
            chunk = alerts[chunk_start : chunk_start + self.batch_limit]
            payload = {
                "alerts": [alert.model_dump(exclude_none=True) for alert in chunk]
            }

            try:
                resp = requests.post(url, json=payload, headers=headers, timeout=10.0)
                if resp.status_code == 200:
                    data = resp.json()
                    chunk_received = data.get("received", len(chunk))
                    chunk_accepted = data.get("accepted", 0)
                    chunk_rejected_raw = data.get("rejected", [])

                    total_received += chunk_received
                    total_accepted += chunk_accepted

                    for r in chunk_rejected_raw:
                        # Offset the index to reflect global position in submitted list
                        global_idx = chunk_start + r.get("index", 0)
                        rejected_item = RejectedAlertItem(
                            index=global_idx,
                            code=r.get("code", "UNKNOWN_ERROR"),
                            message=r.get("message", "Item rejected by fusion engine"),
                        )
                        all_rejected.append(rejected_item)
                        logger.warning(
                            f"Alert at index {global_idx} rejected: [{rejected_item.code}] {rejected_item.message}"
                        )
                else:
                    logger.error(
                        f"POST /v1/alerts/external failed with HTTP {resp.status_code}: {resp.text}"
                    )
                    # Mark all in this chunk as rejected
                    for idx, _ in enumerate(chunk):
                        all_rejected.append(
                            RejectedAlertItem(
                                index=chunk_start + idx,
                                code=f"HTTP_{resp.status_code}",
                                message=resp.text[:200],
                            )
                        )
                    total_received += len(chunk)

            except Exception as exc:
                logger.error(f"Network error communicating with {url}: {exc}")
                for idx, _ in enumerate(chunk):
                    all_rejected.append(
                        RejectedAlertItem(
                            index=chunk_start + idx,
                            code="NETWORK_ERROR",
                            message=str(exc),
                        )
                    )
                total_received += len(chunk)

        return ExternalAlertsResponse(
            received=total_received,
            accepted=total_accepted,
            rejected=all_rejected,
        )


alert_dispatcher = AlertDispatcher()
