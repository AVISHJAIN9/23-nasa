# AstroCare Project Report: Space-Medicine Decision Support System

## 1. Project Mission & Objectives

**AstroCare** is a production-grade, delay-tolerant clinical decision-support and telemetry monitoring platform engineered for deep-space astronaut health management. During long-duration missions beyond Low Earth Orbit—such as lunar Artemis expeditions and crewed Mars transits—radio propagation delays range from **1.3 seconds (Moon)** up to **24 minutes one-way (Mars)**, punctuated by complete planetary communications blackouts (such as solar conjunctions lasting up to two weeks).

Under these constraints, traditional Earth-based real-time telemedicine is physically impossible. AstroCare delivers an autonomous, edge-capable medical operations platform providing:
1. High-throughput biometric vital sign stream ingestion and time-series persistence.
2. Multivariate machine learning anomaly detection and clinical early-warning scoring.
3. Corroborating alert fusion, de-duplication, and autonomous triage workflows.
4. Delay-tolerant store-and-forward communication with conflict-safe synchronization.
5. Autonomous onboard medical guidance checklists (NASA-STD-3001) for blackout survival.
6. Cryptographically hash-chained tamper-evident audit logging for life-safety accountability.
7. Role-based medical confidentiality ensuring flight surgeons retain full clinical visibility while ground controllers and non-medical crew receive appropriately redacted operational situational awareness.

---

## 2. Phase-by-Phase Implementation Summary

### Phase 1 — Core Backend & Real-Time Event Bus
- **Stack**: Node.js 20+, TypeScript (strict ESM), Express 5, Mongoose 8, ioredis 6, Socket.IO 4.
- **Ingestion Pipeline**: RESTful ingestion endpoint (`POST /v1/telemetry`) supporting bulk arrays with batch idempotency and signal quality evaluation.
- **Storage**: MongoDB 7.0 time-series collection (`readings`) optimized with bucketed granularity and compound indexing.
- **Real-Time Event Bus**: Pluggable Redis Streams / Pub-Sub and in-memory fallback, supporting strictly ordered event broadcasting to a WebSocket `/live` namespace with client replay on reconnection.
- **Contract & Standards**: Strictly snake_case JSON schemas, ISO-8601 UTC timestamps, unified error contract (`{ error: { code, message, request_id, details } }`), and complete OpenAPI 3.1 contract registration.

### Phase 2 — Physiological Digital-Twin Simulator (`/simulator`)
- **Stack**: Python 3.11, NumPy, PyYAML, pytest.
- **Mathematical Model**: Per-astronaut physiological twin generating 8 concurrent biometrics (heart rate, SpO2, systolic/diastolic blood pressure, respiration rate, core temperature, cabin ambient CO2, cumulative radiation dose, and HRV RMSSD).
- **Modeled Effects**:
  - Diurnal circadian rhythm cycling (~24h period).
  - Exercise stress cardiovascular response and recovery curves.
  - Microgravity cephalad fluid shift impacting central venous pressures.
  - Cardiovascular deconditioning over mission elapsed days.
  - Cabin CO2 accumulation and hypercapnia response.
  - Solar Proton Event (SPE) acute radiation dose accumulation.
  - Realistic sensor noise and artifact dropouts.
- **Scripted Scenarios**: YAML-driven deterministic scenarios (`normal_day`, `heavy_exercise`, `co2_rise`, `sensor_dropout`, `spike_artifacts`, `cardiac_event_during_blackout`, `slow_degradation_over_days`).
- **Telemetry Client**: CLI runner with rate control, time compression, batch idempotency, and HMAC-SHA256 signature generation.

### Phase 3 — Machine Learning Sidecar (`/ml-sidecar`)
- **Stack**: Python 3.11, FastAPI, scikit-learn, NumPy.
- **Personal Baseline Estimation**: Rolling Welford algorithm computing personalized mean and variance per crew member.
- **Multivariate Anomaly Detection**: Unsupervised **Isolation Forest** coupled with rolling z-score baseline comparisons to detect multidimensional clinical anomalies before catastrophic vital threshold collapse.
- **NEWS2-Style Early Warning**: NASA-adapted multi-vital risk scoring calculating percentage contribution factors for each physiological metric.
- **Evaluation Harness**: Automated harness evaluating all 7 simulator scenarios, generating precision/recall/F1 metrics and performance comparison tables against static thresholds.

### Phase 4 — Delay-Tolerant Autonomy & Comms Emulator
- **Comms Delay Emulator**: Realistic astronomical light-time delay simulation across mission modes (ISS $\sim$0s, Moon $\sim$1.3s, Mars 4–24 min), planetary radio blackouts, and RF packet loss.
- **DTN Store-and-Forward**: Persistent MongoDB DTN queue with monotonic sequence numbering, deduplication, and conflict-safe reconciliation upon link restoration (`onboard_wins` for life-safety emergency decisions; `ground_wins` for administrative prescription updates).
- **Autonomous Guidance**: Standalone clinical checklists for primary emergency hazards (cardiac arrest, acute hypoxia, decompression sickness, hypercapnia, radiation shelter-in-place) ensuring crew medical officers can execute life-safety interventions when Earth is unreachable.

### Phase 5 — Security, Integrity & Audit Ledger
- **Hash-Chained Audit Ledger**: Every security, clinical, and emergency decision is cryptographically chained via SHA-256 (`hash = SHA256(prev_hash + sequence + actor + action + data)`). Includes automated tamper detection.
- **Distributed Rate Limiting**: Redis-backed atomic Lua token bucket rate limiter preserving the `429 RATE_LIMITED` contract, `X-RateLimit-*` headers, and `Retry-After` response headers.
- **Machine Client HMAC Signing**: Telemetry batches from automated simulators and field medical devices are authenticated via HMAC-SHA256 (`X-Telemetry-Signature`).
- **Threat Model & Penetration Testing**: Comprehensive `docs/SECURITY.md` covering OWASP ASVS compliance and 17 automated attack tests in `tests/security.attacks.test.ts` (verifying defense against auth bypass, JWT forgery, cross-crew IDOR, token replay, and payload injection).

### Phase 6 — Observability & Performance Benchmarks
- **Prometheus Metrics Engine**: Zero-dependency exposition collector in `src/core/metrics.ts` exposing standard Prometheus v0.0.4 metrics (`/metrics` and `/v1/metrics`).
- **Grafana Dashboard**: 10-panel space medicine observability dashboard in `docker/grafana/dashboards/astrocare_overview.json` integrated into `docker-compose.yml`.
- **Ingest Benchmark (`npm run bench:ingest`)**:
  - Target: $\ge 1,000$ readings/s sustained.
  - **Measured: 2,687.2 readings/s sustained (268.7% of target, 0 errors across 27,600 readings)**.
- **Live Fanout Benchmark (`npm run bench:live`)**:
  - Target: 50 concurrent live clients fanout under 3.0 s SLA.
  - **Measured: 50 / 50 delivered in 22.30 ms max (p50: 17.52 ms, 0 dropped, 134.5x faster than required SLA)**.

### Phase 7 — Mission Console Dashboard & Demo (`/dashboard`)
- **Stack**: React 18, Vite 5, TypeScript.
- **Aesthetics & UI**: Sleek dark space-flight design system with glassmorphism, glowing telemetry indicators, Orbitron headers, and JetBrains Mono metrics.
- **Live Vitals & Streaming Charts**: Real-time Socket.IO connection with interactive SVG waveforms and threshold evaluations based on NASA-STD-3001 limits.
- **Alert Inbox & Triage**: Prioritized fused alert cards with interactive Acknowledge, Assign, Snooze (with limit validation), and Resolve actions.
- **Medical Confidentiality (NASA-STD-3001)**: Dynamic role-based redaction where flight surgeons access full unredacted clinical histories and notes, while mission controllers view flight telemetry with private medical comments masked.
- **One-Command Demo Script (`make demo`)**: End-to-end scripted runner demonstrating blackout handling, telemetry burst ingestion, ML alert fusion, autonomous protocol execution, and cryptographic audit verification.

---

## 3. Verification & Compliance Matrix

| Phase / Requirement | Verification Command | Status | Result Summary |
| :--- | :--- | :--- | :--- |
| **Backend Test Suite** | `cd backend && npm test` | **PASS** ✅ | 335 tests passing |
| **OpenAPI 3.1 Spec** | `npm test tests/openapi.test.ts` | **PASS** ✅ | Every route documented & validated |
| **Security Attack Suite** | `npm test tests/security.attacks.test.ts` | **PASS** ✅ | 17/17 attack vectors mitigated |
| **Audit Ledger Verification** | `npm run audit:verify` | **PASS** ✅ | Cryptographic integrity verified |
| **Ingestion Benchmark** | `npm run bench:ingest` | **PASS** ✅ | 2,687.2 readings/s sustained (0 errors) |
| **Live Fanout Benchmark** | `npm run bench:live` | **PASS** ✅ | 50 clients in 22.30 ms (< 3.0s SLA) |
| **Simulator Pytest** | `pytest simulator/tests` | **PASS** ✅ | Determinism & physical limits verified |
| **ML Sidecar Pytest** | `pytest ml-sidecar/tests -v` | **PASS** ✅ | Isolation Forest & baseline tests pass |
| **Dashboard Production Build** | `cd dashboard && npm run build` | **PASS** ✅ | TypeScript build in 2.77s |
| **Code Formatting & Lint** | `npm run format:check && npm run lint` | **PASS** ✅ | 0 lint errors, clean formatting |

---

## 4. How to Run AstroCare

### 4.1 One-Command Demonstration
```bash
make demo
```

### 4.2 Full Containerized Stack
```bash
docker compose up --build -d
```
- **Mission Console Dashboard**: `http://localhost:3000`
- **Backend API & Swagger Docs**: `http://localhost:4000/docs`
- **Prometheus Metrics Scraper**: `http://localhost:9090`
- **Grafana Observability**: `http://localhost:3001` (Credentials: `admin` / `astrocare_admin`)

---

## 5. Known Limitations & Future Roadmap

1. **Orbital Ephemeris Realism**: Current planetary delay calculation models average Mars orbital distance approximations rather than full SPICE toolkit ephemeris files. Future versions can incorporate NASA NAIF/SPICE kernels for exact relativistic delay modeling.
2. **Hardware-in-the-Loop Telemetry**: Telemetry streams are produced by the mathematical digital twin; future extensions can integrate Bluetooth Low Energy (BLE) bio-monitors or simulated hardware telemetry feeds.
3. **Federated Clinical Models**: Future evolutions can deploy federated learning across multiple exploratory vehicles (e.g. Lunar Gateway, Mars Transit Vehicle, and Martian surface habitat) to train shared anomaly detection models without transmitting raw, sensitive clinical records over delayed radio links.
