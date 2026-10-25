# Project Map: 25 nasa (AstroCare)

## Folder Structure
```
25 nasa/
├── docs/                               # Comprehensive VitePress Documentation Suite
├── nasa/                               # AstroCare Core Project
│   ├── backend/                        # Node.js 20 / TypeScript 5 Strict ESM Server
│   │   ├── src/
│   │   │   ├── config/                 # Environment & mission profile configs
│   │   │   ├── models/                 # Mongoose Time-Series & Alert schemas
│   │   │   ├── routes/                 # Express 5 REST controllers & OpenAPI routes
│   │   │   ├── services/               # Core business logic:
│   │   │   │   ├── ingestService.ts    # Telemetry ingestion & idempotency leases
│   │   │   │   ├── qualityService.ts   # Plausibility checks, spike & flatline filters
│   │   │   │   ├── linkEmulator.ts     # OWLT dynamic delay simulator (Mars/Moon/ISS)
│   │   │   │   ├── storeAndForward.ts  # Orbital blackout queue & outbox pattern
│   │   │   │   ├── fusionEngine.ts     # Alert deduplication & priority scoring
│   │   │   │   ├── mlClient.ts         # HTTP bridge to Python ML sidecar
│   │   │   │   └── liveService.ts      # Socket.IO telemetry & alert streaming
│   │   │   ├── bus/                    # Redis Streams & In-Memory EventBus adapters
│   │   │   └── server.ts               # Application entry point & lifecycle
│   │   ├── tests/                      # 49 Vitest unit, integration & security test suites
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── dashboard/                      # React 18 / Vite Astronaut & Surgeon Client
│   │   ├── src/
│   │   │   ├── components/             # Real-time vital graphs, alert inboxes, comms status
│   │   │   └── App.tsx
│   │   └── package.json
│   ├── ml-sidecar/                     # Python FastAPI Predictive Clinical ML Service
│   │   ├── ml_sidecar/                 # Feature extraction & decompensation model
│   │   └── requirements.txt
│   ├── simulator/                      # Biometric multi-astronaut telemetry generator
│   └── docker-compose.yml              # Multi-container orchestration (App, Mongo, Redis, ML)
```

## Tech Stack & Dependencies
- `express@^5.0.1`: High-performance HTTP server with async error propagation.
- `socket.io@^4.8.1`: Bidirectional low-latency event gateway.
- `ioredis@^6.0.0`: Redis Streams client for delayed queues and pub/sub.
- `mongoose@^8.12.1`: MongoDB object modeling with Time-Series support.
- `zod@^3.24.2`: Strict runtime schema validation and type inference.
- `pino@^9.6.0`: High-speed JSON structured logger.
- `vitest@^3.0.7`: Modern ESM test runner with native mock support.
