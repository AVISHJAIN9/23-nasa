# Quality, Testing & Operations

## Automated Testing Suite (49 Vitest Suites)
- **Signal Quality Tests**: `telemetry.quality.test.ts` validates plausibility boundaries, 3-reading spike filters, and flatline detection.
- **Interplanetary Link Tests**: `link.emulator.test.ts` and `link.storeAndForward.test.ts` verify delay ordering and blackout recovery.
- **Alert Fusion Storms**: `fusion.storm.test.ts` asserts that 100 simultaneous concurrent alerts collapse into $\le 3$ fused clinical incidents.
- **Security Tests**: `security.attacks.test.ts` tests timing-attack resistance and replay protections.
