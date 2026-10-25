# AstroCare Performance & Observability Report (Phase 6)

## 1. Executive Summary

This document presents the empirical benchmark results, load verification data, and observability infrastructure for **AstroCare: Space-Medicine Decision Support System**.

Under deep-space mission profiles (ISS, Moon, Mars), the system must guarantee high-throughput ingestion of multi-vital biometric streams, sub-second alerting, and rapid live telemetry broadcast to flight surgeon dashboards while operating under zero-dependency Prometheus observability.

### Performance Target Summary
| Metric | SLA Target | Measured Performance | Margin | Result |
| :--- | :--- | :--- | :--- | :--- |
| **Sustained Ingest Throughput** | $\ge 1,000$ readings/s | **2,687.2 readings/s** | $+168.7\%$ | **PASSED** ✅ |
| **Ingest Error Rate** | $0.0\%$ | **0.0% (0 errors / 276 batches)** | $0.0\%$ errors | **PASSED** ✅ |
| **Ingest Latency (p50)** | $< 500$ ms | **397.08 ms** | $-20.6\%$ | **PASSED** ✅ |
| **Ingest Latency (p95)** | $< 1,000$ ms | **636.30 ms** | $-36.4\%$ | **PASSED** ✅ |
| **Live Fanout Latency (p50)** | $< 3,000$ ms | **17.52 ms** | $-99.4\%$ | **PASSED** ✅ |
| **Live Fanout Latency (Max)** | $< 3,000$ ms | **22.30 ms** | $-99.3\%$ | **PASSED** ✅ |
| **Live Delivery Reliability** | $100\%$ delivery | **100% (50/50 clients)** | $0$ dropped | **PASSED** ✅ |

---

## 2. Ingestion Benchmark (`npm run bench:ingest`)

### Benchmark Architecture & Methodology
- **Harness**: Self-contained TypeScript runner ([`src/scripts/benchIngest.ts`](file:///backend/src/scripts/benchIngest.ts)).
- **Database**: MongoDB 7.0 time-series collection (`readings` with metaField `crew_id`, timeField `timestamp`).
- **Telemetry Dataset**: Synthetic 6-astronaut crew (`CREW-BENCH-1` through `6`) generating realistic vital sign vectors (heart rate, SpO2, systolic/diastolic blood pressure, respiration rate, core temperature, cabin CO2, HRV, ambient radiation).
- **Client Protocol**: HTTP/1.1 POST `/v1/telemetry` authenticated with `X-Ingest-Key`.

### Phase 1: Baseline Cadence (1 Hz Telemetry)
Simulates normal cruise-phase operations where vitals arrive at 1 Hz intervals:
- **Duration**: 11.6 seconds
- **Readings Ingested**: 1,000 readings (10 batches of 100 readings)
- **Mean Ingest Rate**: 86.1 readings/s
- **Latency Distribution**:
  - **p50 Latency**: 140.70 ms
  - **p95 Latency**: 294.46 ms

### Phase 2: High-Throughput Sustained Ingestion
Simulates high-rate telemetry burst conditions (e.g., EVA egress, extravehicular exercise, multi-astronaut triage event):
- **Target**: Sustained $\ge 1,000$ readings/s for 10 consecutive seconds.
- **Duration**: 10.27 seconds
- **Batches Processed**: 276 batches
- **Total Readings Ingested**: **27,600 readings**
- **Sustained Throughput**: **2,687.2 readings/s**
- **Latency Distribution**:
  - **p50 Latency**: 397.08 ms
  - **p95 Latency**: 636.30 ms
  - **p99 Latency**: 665.96 ms
- **Failed Batches / Errors**: **0 (0.00%)**

```
====================================================
📊 INGEST BENCHMARK RESULTS
====================================================
⏱️  Duration:           10.27 s
📦 Batches Processed:  276
📈 Readings Ingested:  27,600
🚀 Sustained Rate:     2,687.2 readings/s
⚡ p50 Latency:        397.08 ms
⚡ p95 Latency:        636.30 ms
⚡ p99 Latency:        665.96 ms
❌ Errors:             0
====================================================
🎯 SUCCESS: Target of >= 1,000 readings/s achieved!
```

---

## 3. Real-Time Live Client Fanout Benchmark (`npm run bench:live`)

### Benchmark Architecture & Methodology
- **Harness**: Self-contained WebSocket benchmark ([`src/scripts/benchLive.ts`](file:///backend/src/scripts/benchLive.ts)).
- **Transport**: Socket.IO 4.8 over native WebSocket transport.
- **Client Fleet**: 50 concurrent authenticated clients spanning diverse roles:
  - 13 Astronaut clients
  - 13 Flight Surgeon clients
  - 12 Mission Control ground controllers
  - 12 System Administrators
- **Security**: Per-client JWT bearer tokens with distinct role claims and cryptographic signature validation.
- **Target Event**: Critical emergency broadcast (`emergency.declared`, topic `emergency`, audience `all`, cardiac arrest payload).

### Measured Delivery Performance
- **Client Fleet Connection Time**: 50 clients connected in 399.3 ms
- **Delivery Reliability**: 50 / 50 delivered (100.0%)
- **Packet Loss / Missed**: 0
- **Duplicate Frames**: 0
- **Total Wall-Clock Fanout**: 22.34 ms
- **Latency Distribution Across Clients**:
  - **Minimum Latency**: 11.17 ms
  - **p50 Latency**: **17.52 ms**
  - **p95 Latency**: **21.84 ms**
  - **p99 Latency**: **22.30 ms**
  - **Maximum Latency**: **22.30 ms**
- **SLA Assessment**: Target $< 3,000$ ms; measured max $22.30$ ms (**134.5x faster than required SLA**).

```
======================================================
⚡ ASTROCARE LIVE FANOUT BENCHMARK
🎯 Fleet: 50 concurrent live clients (all roles)
======================================================
Total Clients Connected:   50
Delivered Events:          50 / 50
Missed Events:             0
Duplicate Deliveries:      0
Total Wall-Clock Time:     22.34 ms
Delivery Latency (p50):    17.52 ms
Delivery Latency (p95):    21.84 ms
Delivery Latency (p99):    22.30 ms
Min Latency:               11.17 ms
Max Latency:               22.30 ms
------------------------------------------------------
Status:                    PASSED (< 3.0s SLA) ✅
```

---

## 4. Prometheus Observability Architecture

The system implements a zero-dependency, low-overhead Prometheus exposition engine ([`src/core/metrics.ts`](file:///backend/src/core/metrics.ts)). It provides metrics on both `/metrics` (root scrape endpoint) and `/v1/metrics` (OpenAPI 3.1 registered endpoint).

### Metric Catalog
| Metric Name | Type | Labels | Description |
| :--- | :--- | :--- | :--- |
| `http_requests_total` | Counter | `method`, `path`, `status` | Cumulative count of HTTP requests handled. |
| `http_request_duration_seconds` | Histogram | `method`, `path`, `le` | Request duration distribution across 11 buckets (`0.005` to `10.0` s). |
| `telemetry_ingested_readings_total` | Counter | _none_ | Total vital sign readings successfully processed and persisted. |
| `telemetry_ingest_rate_readings_per_second` | Gauge | _none_ | Instantaneous rolling ingestion throughput in readings/second. |
| `alerts_active_count` | Gauge | `severity` (`red`, `amber`, `watch`) | Currently unresolved medical alerts by triage tier. |
| `alerts_raised_total` | Counter | `hazard`, `severity` | Total medical alerts generated by clinical alert engine & ML sidecar. |
| `event_bus_lag_events` | Gauge | `topic` | Unacknowledged queue lag in event bus stream topics. |
| `link_blackout_active` | Gauge | `mission_mode` | Binary flag (1 = blackout active, 0 = link online). |
| `link_one_way_delay_seconds` | Gauge | `mission_mode` | One-way light-time communication delay (e.g. Mars 240–1440 s). |
| `link_packet_loss_rate` | Gauge | `mission_mode` | Simulated deep-space radio transmission packet drop rate. |

---

## 5. Grafana Dashboard & Container Integration

### Provisioning Structure
```
docker/
├── prometheus/
│   └── prometheus.yml                     # 5s scrape interval targeting api:4000/metrics
└── grafana/
    ├── dashboards/
    │   └── astrocare_overview.json        # Unified 10-panel space medicine observability dashboard
    └── provisioning/
        ├── datasources/
        │   └── datasources.yml            # Auto-provisions Prometheus datasource (http://prometheus:9090)
        └── dashboards/
            └── dashboards.yml             # Auto-loads AstroCare Overview dashboard on startup
```

### Dashboard Panels ([`docker/grafana/dashboards/astrocare_overview.json`](file:///docker/grafana/dashboards/astrocare_overview.json))
1. **Row 1: Mission Telemetry & Comms Status**
   - Panel 1 (Stat): Instantaneous Ingestion Throughput (`telemetry_ingest_rate_readings_per_second`).
   - Panel 2 (Stat): Deep-Space Light-Time One-Way Delay (`link_one_way_delay_seconds`).
   - Panel 3 (Stat): Link Blackout Indicator (`link_blackout_active`, green = active, red = blackout).
   - Panel 4 (Stat): Active Clinical Alerts by Severity (`alerts_active_count`).
2. **Row 2: HTTP API Performance & Latency**
   - Panel 5 (TimeSeries): API Latency Quantiles (p50, p95, p99 calculated via `histogram_quantile`).
   - Panel 6 (TimeSeries): API Request Rate grouped by route and status code.
3. **Row 3: Telemetry Pipeline & Event Bus Observability**
   - Panel 7 (TimeSeries): Ingested Readings Throughput Over Time.
   - Panel 8 (TimeSeries): Real-Time Event Bus Topic Lag.
4. **Row 4: Clinical Alerts & Deep-Space Delay Tracking**
   - Panel 9 (Bar Chart): Alerts Raised by Clinical Hazard and Severity.
   - Panel 10 (Dual-Axis TimeSeries): One-Way Delay (seconds) & Packet Loss Rate (%).

### Docker Compose Services (`docker-compose.yml`)
- `prometheus`: `prom/prometheus:v2.51.0` exposed on port `9090`.
- `grafana`: `grafana/grafana:10.4.0` exposed on port `3001` with pre-configured dashboard provisioning and credentials (`admin / astrocare_admin`).

---

## 6. How to Run Benchmarks & View Metrics

### Running Ingest Benchmark
```bash
cd backend
npm run bench:ingest
```

### Running Live Client Broadcast Benchmark
```bash
cd backend
npm run bench:live
```

### Starting the Full Observability Stack
```bash
docker-compose up -d prometheus grafana api mongo redis ml-sidecar
```
- **Prometheus UI**: `http://localhost:9090`
- **Grafana UI**: `http://localhost:3001` (Credentials: `admin` / `astrocare_admin`)
- **API Metrics**: `http://localhost:4000/metrics` or `http://localhost:4000/v1/metrics`
