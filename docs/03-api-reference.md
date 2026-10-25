# API Reference: AstroCare Platform

## 1. Machine Telemetry Ingest
`POST /api/telemetry`
- **Headers**: `X-Ingest-Key: <secret>`, `X-Idempotency-Key: <uuid>`
- **Payload**:
```json
{
  "crewMemberId": "astronaut-01",
  "timestamp": "2026-10-25T02:00:00Z",
  "readings": {
    "heartRate": 82,
    "spo2": 98.5,
    "systolicBp": 120,
    "diastolicBp": 78,
    "coreTemp": 37.1
  }
}
```
- **Responses**:
  - `201 Created`: Telemetry accepted and quality filtered.
  - `200 OK` (`Idempotency-Replayed: true`): Cached response returned without re-processing.

---

## 2. Active Alert Inbox
`GET /api/alerts/inbox`
- **Query Params**: `severity=CRITICAL&status=ACTIVE`
- **Response**: List of deduplicated, fused clinical alert cards with priority scores and raw telemetry snippets.

---

## 3. Communication Link Configuration
`POST /api/comms/link`
- **Payload**: `{"mode": "mars", "blackout": false}`
- **Response**: `{"status": "configured", "delaySeconds": 720, "owlt": "12m 00s"}`
