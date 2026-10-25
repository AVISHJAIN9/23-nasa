# F1: Telemetry Ingest & Signal Quality Analyzer

## Overview
High-throughput telemetry pipeline handling physiological data streams with idempotency leasing, plausibility validation, spike rejection, and linear interpolation.

## Source References
- `src/services/ingestService.ts:34-112`
- `src/services/qualityService.ts:25-98`

## Say It Out Loud
> "I built the Telemetry Ingestion and Signal Quality Analyzer to handle noisy biometric streams in microgravity. In `ingestService.ts`, incoming sensor payloads are verified with constant-time HMAC tokens and an atomic 60-second idempotency lease to prevent duplicate submissions. In `qualityService.ts`, the readings pass through physiological plausibility checks, spike filters that reject single-point sensor noise, and flatline detection."
