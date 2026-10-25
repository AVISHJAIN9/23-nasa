# Build Order: Reconstructing AstroCare

## Step-by-Step Implementation Flow

```mermaid
flowchart TD
    Step1[1. Time-Series Schemas & Config] --> Step2[2. EventBus Memory/Redis Layer]
    Step2 --> Step3[3. Ingest & Signal Quality Engine]
    Step3 --> Step4[4. Alert Rules & Fusion Core]
    Step4 --> Step5[5. Comms Delay & Outbox Emulator]
    Step5 --> Step6[6. ML Sidecar Bridge]
    Step6 --> Step7[7. Socket.IO Live Streaming & Dashboard]
```

1. **Schemas & Configuration**: Define MongoDB Time-Series collection schemas for physiological vitals and Zod contract validators.
2. **EventBus Abstraction**: Build `bus/` supporting dual in-memory and Redis Streams backplanes.
3. **Ingest & Quality Filtering**: Implement `ingestService.ts` with atomic idempotency leases and `qualityService.ts` for noise filtering.
4. **Alert Rules & Fusion**: Develop rule engine and multi-vital correlation in `fusionEngine.ts`.
5. **Delay Emulator**: Build `linkEmulator.ts` and blackout queue in `storeAndForward.ts`.
6. **ML Sidecar**: Mount HTTP bridge to Python predictive decompensation model.
7. **Real-Time Gateway**: Expose Socket.IO `/live` and `/ingest` namespaces and connect React dashboard.
