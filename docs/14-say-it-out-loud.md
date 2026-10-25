# Say It Out Loud: Spoken Interview Scripts

## Project Pitch (60 Seconds)
> "I built AstroCare, an autonomous clinical telemetry and decision-support platform for deep-space Mars missions where communication delays with Earth reach 24 minutes. Built with TypeScript, Express 5, MongoDB Time-Series, and Redis Streams, it ingests multi-lead biometric streams, filters sensor artifacts with a Signal Quality Analyzer, fuses alerts to eliminate alarm fatigue, and uses a machine learning sidecar to predict clinical decompensation 30 minutes in advance, while modeling interplanetary communication delays for Earth ground control."

## Feature Scripts
### F1: Telemetry Ingestion & Signal Quality
> "I built the Telemetry Ingestion and Signal Quality Analyzer to handle noisy biometric streams in microgravity. In `ingestService.ts`, incoming sensor payloads are verified with constant-time HMAC tokens and an atomic 60-second idempotency lease to prevent duplicate submissions. In `qualityService.ts`, the readings pass through physiological plausibility checks, spike filters that reject single-point sensor noise, and flatline detection before entering MongoDB."

### F2: Interplanetary Delay Emulator
> "To replicate real mission physics, I engineered the Comms Delay Emulator in `linkEmulator.ts`. For ISS missions, latency is zero; for Lunar Artemis missions, it adds 1.3 seconds; and for Mars, it dynamically models 3 to 22 minutes of light-time delay based on planetary orbital alignment, buffering data in persistent outbox queues during planetary blackouts."
