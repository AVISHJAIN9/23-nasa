# Project Pitch: AstroCare

## 30-Second Elevator Pitch
"I built **AstroCare**, a mission-critical space-medicine decision-support platform designed for deep-space Mars missions where one-way communication latency to Earth reaches 24 minutes. Built with TypeScript, Express 5, MongoDB Time-Series, and Redis Streams, it ingests multi-lead bio-telemetry with real-time signal quality filtering, fuses alerts to prevent alarm fatigue, runs an ML sidecar predicting cardiovascular decompensation 30 minutes in advance, and provides delay-tolerant store-and-forward synchronization with Earth Mission Control."

## 2-Minute Spoken Pitch
"When astronauts travel to Mars, real-time medical guidance from Earth is physically impossible due to the speed of light—a radio signal takes between 3 and 22 minutes each way. If an astronaut experiences cardiac arrhythmia or toxic gas inhalation during an extravehicular activity (EVA), waiting for a flight surgeon in Houston to reply would take almost an hour.

To solve this autonomy crisis, I engineered AstroCare:

First, our high-throughput ingestion engine in `ingestService.ts` accepts biometric telemetry—heart rate, SpO2, multi-lead ECG, blood pressure, and core temperature—at over 1,000 readings per second with strict idempotency and HMAC machine authentication.

Second, bio-sensor telemetry in microgravity is noisy. Our Signal Quality Analyzer in `qualityService.ts` screens physiological plausibility, filters motion artifacts and sensor spikes, detects flatlines, and applies linear interpolation over transient sensor dropouts before data touches our MongoDB time-series collection.

Third, our Alert Fusion Engine solves clinical alarm fatigue. Instead of firing 20 overlapping alarms when an astronaut exercises or decompensates, it groups related anomalies, calculates cross-vital confidence scores, and routes single prioritized clinical incidents to the crew medic.

Fourth, our ML Sidecar runs continuous inference on 15-minute vital trajectories, predicting acute decompensation up to 45 minutes before clinical failure.

Finally, for Earth communication, our Comms Delay Emulator models orbital geometry, delay-tolerant networking, and planetary blackout buffers. Local crew medics receive instant sub-10ms alerts over Socket.IO, while Earth flight surgeons receive accurately delayed, role-redacted historical replays."
