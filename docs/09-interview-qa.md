# Interview Preparation: 150+ Questions & Answers

## Core Architectural Questions

### Q1: Can you walk me through the architecture of AstroCare?
**Answer**:
AstroCare is an autonomous, delay-tolerant space-medicine telemetry and clinical decision-support platform built with TypeScript, Express 5, MongoDB Time-Series, Redis Streams, and Socket.IO. It operates under the physical constraints of deep-space missions, where communication to Earth has up to 24 minutes of one-way light-time delay. Bio-telemetry is ingested via machine-authenticated HMAC endpoints, cleaned by a Signal Quality Analyzer that filters microgravity motion artifacts and sensor spikes, and stored in MongoDB Time-Series. An Alert Fusion Engine eliminates alarm fatigue by consolidating overlapping vitals into prioritized clinical incidents, while a Python ML sidecar predicts decompensation 30 minutes in advance. Local crew medics receive instant sub-10ms alerts over Socket.IO, while Earth ground control receives delayed, role-redacted telemetry via our delay-tolerant store-and-forward relay.

### Q2: How do you handle deep-space communication delays in the data layer?
**Answer**:
In `linkEmulator.ts`, we model interplanetary radio delay as an asynchronous priority stream using Redis Streams. When an alert or vital packet is generated aboard the spacecraft, it is tagged with its origination timestamp and scheduled delivery time based on the active mission mode—such as 12 minutes for Mars. The delay worker reads packets only when their scheduled arrival timestamp is reached, perfectly simulating speed-of-light delays while keeping local spacecraft medical operations entirely unblocked.

### Q3: What is your Signal Quality Analyzer and why is it necessary?
**Answer**:
In spaceflight, biometric sensors frequently slip during exercise or extravehicular activities, producing sudden unrealistic spikes or flatline dropouts. If raw sensor data triggered alerts directly, flight crews would experience severe alarm fatigue. In `qualityService.ts`, every reading passes through physiological plausibility boundaries, a 3-reading spike rejection filter that verifies whether a sudden change is sustained, flatline detection, and linear interpolation over short sensor disconnections.

### Q4: How do you prevent alarm fatigue during an emergency?
**Answer**:
When an astronaut suffers an acute medical event, multiple biometrics deteriorate simultaneously—heart rate spikes, blood pressure drops, and SpO2 plummets. Standard monitors would trigger three loud, separate alarms. In `fusionEngine.ts`, we implement an alert fusion window that correlates alerts within a 30-second window, computes a cross-vital confidence score, and emits a single, prioritized clinical incident card with full diagnostic traces.

### Q5: How do you ensure medical records are not tampered with?
**Answer**:
We implement a cryptographically linked audit ledger in `auditService.ts`. Every clinical state change, prescription, and triage action generates an entry containing a SHA-256 HMAC hash of its contents plus the hash of the preceding entry. If an entry is modified or deleted, the hash chain breaks, allowing Earth flight surgeons to mathematically verify the chronological integrity of all autonomous actions taken by the crew.
