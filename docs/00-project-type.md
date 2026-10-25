# Step 0 Pre-Check: Project Type Detection

## Detected Project Type
**Primary Type**: Distributed Deep-Space Clinical Telemetry & Delay-Tolerant Decision-Support Platform (Node.js 20 / TypeScript 5 Strict ESM + Express 5 + Socket.IO + MongoDB Time-Series + Redis Streams + Python ML Sidecar + React 18 Dashboard)
**Sub-Category**: Autonomous Mission-Critical Healthcare, High-Throughput Bio-Telemetry, Signal Quality Analysis (SQA), Comms Delay Emulation (DTN).

## Evidence
- **Backend Core**: Express 5.0.1, TypeScript 5.7.3 strict ESM (`25 nasa/nasa/backend/`), Socket.IO 4.8.1.
- **Database**: MongoDB 8.12.1 with Mongoose time-series collections for physiological vitals.
- **Event Bus & Storage**: Redis Streams (`ioredis` 6.0.0) for delayed message buffers and pub/sub.
- **ML Inference Sidecar**: Python FastAPI service (`ml-sidecar/`) for predictive shock and cardiac decompensation.
- **Signal Quality & Ingest**: `src/services/qualityService.ts`, `src/services/ingestService.ts` (spike rejection, flatline detection, idempotency lease locking).
- **Delay-Tolerant Relay**: `src/services/linkEmulator.ts`, `src/services/storeAndForward.ts` (OWLT: ISS 0s, Moon 1.3s, Mars 3-22m, blackout queues).
- **Frontend Dashboard**: React 18.3.1, Vite 5.4.11 (`dashboard/`), Socket.IO client.
- **Testing**: Vitest 3.0.7 across 49 comprehensive unit/integration test suites.

## Documentation Track
- **Full Stack / Mission-Critical Systems Track**: End-to-end signal processing, delay-tolerant networking (DTN), alert fusion engines, machine authentication (HMAC), and ML sidecar integration.
