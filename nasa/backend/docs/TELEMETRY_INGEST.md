# AstroCare Telemetry Ingestion API (F013 & F019)
**Handoff Guide for Python Simulator Author and ML1 Medical Expert**

This document specifies the ingestion interfaces for the space-medicine telemetry pipeline. The backend accepts high-frequency sensor readings via HTTP POST and Socket.IO WebSocket streaming.

---

## 1. Authentication & Machine Caller Credentials

Machine callers (such as the autonomous Python telemetry simulator) authenticate via the **`X-Ingest-Key`** header or Socket.IO handshake auth `ingest_key`.

- **HTTP Header**: `X-Ingest-Key: <ASTRO_INGEST_API_KEY>`
- **WebSocket Handshake Auth**: `{ "ingest_key": "<ASTRO_INGEST_API_KEY>" }`

> [!NOTE]
> Service callers using a valid `X-Ingest-Key` are authorized to submit telemetry batches for any crew member. Human users (astronauts submitting personal sensor data) authenticate via standard Bearer JWT tokens and are restricted to their own linked crew profile.

---

## 2. Ingestion Endpoints

### 2.1 HTTP POST `/v1/telemetry`

- **Content-Type**: `application/json`
- **Headers**:
  - `X-Ingest-Key: <key>`
  - `Idempotency-Key: <optional-client-uuid>`

#### Request Body Example
```json
{
  "batch_id": "sim-sol42-batch-001",
  "readings": [
    {
      "crew_id": "660e8400e29b41d4a7164466",
      "metric": "heart_rate",
      "value": 74.2,
      "unit": "bpm",
      "timestamp": "2026-10-18T12:00:00.000Z",
      "source": "simulated",
      "device_id": "ecg-lead-2",
      "mission_day": 42
    },
    {
      "crew_id": "660e8400e29b41d4a7164466",
      "metric": "spo2",
      "value": 98.5,
      "unit": "%",
      "timestamp": "2026-10-18T12:00:00.000Z",
      "source": "simulated",
      "device_id": "pulse-ox-01",
      "mission_day": 42
    },
    {
      "crew_id": "660e8400e29b41d4a7164466",
      "metric": "resp_rate",
      "value": null,
      "unit": "breaths/min",
      "timestamp": "2026-10-18T12:00:00.000Z",
      "source": "simulated",
      "device_id": "chest-band-1",
      "mission_day": 42
    }
  ]
}
```

#### Field Specifications:
- `crew_id` *(string, required)*: 24-character hexadecimal MongoDB ObjectId of the astronaut.
- `metric` *(string, required)*: One of `heart_rate`, `spo2`, `systolic`, `diastolic`, `temp_c`, `resp_rate`, `hrv_rmssd`.
- `value` *(number | null, required)*: Measured value. A `null` value indicates sensor dropout.
- `timestamp` *(string, required)*: ISO 8601 UTC timestamp strictly ending in `Z` (e.g. `2026-10-18T12:00:00.000Z`). Timezone offsets like `+02:00` are rejected.
- `source` *(string, required)*: `simulated`, `replayed_dataset`, or `real_device`.
- `dataset_id` *(string, required if source is `replayed_dataset`)*: Provenance identifier for replayed benchmark datasets.
- `device_id` *(string, optional)*: Hardware / channel identifier.
- `mission_day` *(number, optional)*: Mission elapsed day (non-negative).
- `unit` *(string, optional)*: If supplied, must match the metric's canonical unit (`bpm`, `%`, `mmHg`, `C`, `breaths/min`, `ms`).

#### Success Response (200 OK)
```json
{
  "batch_id": "sim-sol42-batch-001",
  "received": 3,
  "accepted": 3,
  "rejected": [],
  "duplicates_in_batch": 0,
  "interpolated": 0,
  "gaps": [],
  "quality": {
    "ok": 2,
    "flagged": 1,
    "by_flag": {
      "dropout": 1,
      "implausible": 0,
      "flatline": 0,
      "spike": 0,
      "interpolated": 0
    }
  }
}
```

#### cURL Example
```bash
curl -X POST http://localhost:4000/v1/telemetry \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Key: dev_test_insecure_ingest_api_key_32_chars!" \
  -H "Idempotency-Key: sim-batch-001" \
  -d '{
    "batch_id": "sim-batch-001",
    "readings": [
      {
        "crew_id": "660e8400e29b41d4a7164466",
        "metric": "heart_rate",
        "value": 72,
        "timestamp": "2026-10-18T12:00:00.000Z",
        "source": "simulated"
      }
    ]
  }'
```

---

### 2.2 WebSocket Streaming (`/ingest` Namespace)

For low-latency continuous streaming from the simulator, connect to the Socket.IO `/ingest` namespace.

#### Python Simulator Example (`python-socketio`)
```python
import socketio

sio = socketio.Client()

@sio.event(namespace='/ingest')
def connect():
    print("Connected to AstroCare /ingest namespace")

@sio.event(namespace='/ingest')
def connect_error(data):
    print(f"Connection failed: {data}")

sio.connect(
    'http://localhost:4000',
    namespaces=['/ingest'],
    auth={'ingest_key': 'dev_test_insecure_ingest_api_key_32_chars!'},
    transports=['websocket']
)

batch_payload = {
    "batch_id": "py-sim-batch-001",
    "readings": [
        {
            "crew_id": "660e8400e29b41d4a7164466",
            "metric": "heart_rate",
            "value": 75.0,
            "timestamp": "2026-10-18T12:00:00.000Z",
            "source": "simulated"
        }
    ]
}

def on_ack(response):
    print("Batch acknowledgment received:", response)

sio.emit('telemetry:batch', batch_payload, namespace='/ingest', callback=on_ack)
sio.wait()
```

---

## 3. Signal Quality & Missing-Data Rules (F019)

Every stored reading is automatically annotated with a quality block: `{ flag, reasons: [] }`.

### 3.1 Quality Flags & Priority Order
When multiple conditions apply, the primary flag is determined by severity:
`dropout` > `implausible` > `spike` > `flatline` > `interpolated` > `ok`

1. **`dropout`**: The reading payload had `value: null`. Stored with `value: null` to record sensor dropout.
2. **`implausible`**: The value falls outside physically possible human sensor output (e.g. heart rate < 20 or > 250 bpm; sentinel values like -999).
3. **`spike`**: The rate of change relative to the last good reading exceeds the metric's configured `max_rate_per_s`.
   - **Level Shift Safety Rule**: If 3 consecutive spike readings are consistent with each other (within `level_shift_tolerance`), the system treats this as a genuine physiological state change (e.g. sudden arrhythmia or physical exertion). The 3rd reading is accepted as `"ok"` with reason `level_shift_accepted`.
4. **`flatline`**: The sensor value has not changed beyond `flatline_epsilon` for a duration equal to or exceeding `flatline_window_s` in reading timestamps.
5. **`interpolated`**: A short missing gap (`> 1.5x expected_interval` and `<= ASTRO_TELEMETRY_MAX_INTERP_GAP_S`) was automatically filled using linear interpolation at `expected_interval` increments.
6. **`ok`**: The reading is physiologically plausible, continuous, and validated. **Only readings with quality flag "ok" are eligible to trigger medical emergency alerts.**

> [!IMPORTANT]
> **Plausibility vs Alert Thresholds:**
> Plausibility ranges represent *physical sensor feasibility*, NOT clinical safety thresholds. For example, an SpO2 of 60% represents acute respiratory distress, but it is a physically real sensor measurement and MUST remain flagged `"ok"` so the downstream Part 2b clinical alert engine can fire alarms. Sentinels (0% or -999) are classified as `"implausible"`.

---

## 4. Default Quality Settings (Assumptions for Review)

| Metric | Canonical Unit | Plausible Range | Flatline Window | Max Rate / s | Level Shift Tol | Epsilon | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `heart_rate` | `bpm` | 20 – 250 | 15 s | 25 / s | 5.0 bpm | 0.01 | Extreme tachycardia / bradycardia covered |
| `spo2` | `%` | 50 – 100 | 30 s | 5 / s | 2.0 % | 0.1 | 60% SpO2 remains "ok" (emergency) |
| `systolic` | `mmHg` | 50 – 260 | 60 s | 40 / s | 5.0 mmHg | 0.5 | Arterial pressure line bounds |
| `diastolic` | `mmHg` | 30 – 160 | 60 s | 30 / s | 5.0 mmHg | 0.5 | Arterial pressure line bounds |
| `temp_c` | `C` | 30.0 – 43.0 | 120 s | 0.5 / s | 0.2 C | 0.02 | Core body temp (hypothermia to fever) |
| `resp_rate` | `breaths/min` | 4 – 60 | 30 s | 10 / s | 2.0 breaths/min | 0.1 | Bradypnea to severe tachypnea |
| `hrv_rmssd` | `ms` | 1 – 300 | 60 s | 60 / s | 5.0 ms | 0.5 | Autonomic nervous system marker |

*Status: ASSUMPTIONS - Flagged for ML1 / Medical Team review.*

---

## 5. Time Acceleration & Replays

- The pipeline evaluates all temporal rules (flatline, spikes, gaps) using **reading timestamps (`timestamp`)**, NEVER the server wall clock.
- When running 10x or 100x accelerated simulations or replaying historical dataset logs, simply advance the `timestamp` values in the reading payload. The quality engine will process them with full fidelity.

---

## 6. Batching & Idempotency Best Practices

- **Recommended Batch Size**: 50 to 200 readings per batch for optimal network throughput and memory consumption. Maximum allowed is 500 readings per batch.
- **Idempotency Key Resolution**:
  1. `Idempotency-Key` HTTP header
  2. Payload `batch_id`
  3. Implicit SHA-256 hash of the canonical JSON request payload
- **Safe Retries**: If a network timeout or connection reset occurs, resend the exact same payload with the same `batch_id` or `Idempotency-Key`. The backend detects the completed record and returns the cached 200 response with `Idempotency-Replayed: true` without duplicating writes.
