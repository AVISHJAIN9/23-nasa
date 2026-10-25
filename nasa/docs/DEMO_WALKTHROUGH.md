# AstroCare Demonstration & Evaluation Walkthrough

This document provides a guided walkthrough for evaluators, instructors, and developers to experience **AstroCare: Space-Medicine Decision Support System** end-to-end.

---

## 1. Quick Start: The One-Command Demo

To run the complete scripted end-to-end scenario demonstrating telemetry ingestion, machine learning anomaly detection, alert fusion, autonomous blackout guidance, and audit ledger verification in an isolated harness:

```bash
# From workspace root
make demo

# Or from /backend
cd backend
npm run demo
```

### What the One-Command Demo Executes:
1. **Initializes Environment**: Configures MongoDB and starts an isolated backend server.
2. **Seeds Personnel**: Creates crew profiles (`Ares-Lead`) and personnel accounts (`Dr. Sarah Connor`).
3. **Simulates Comms Blackout**: Engages Mars solar conjunction mode ($\sim 14$ min delay, radio carrier lost).
4. **Ingests Vital Anomaly**: Posts 5 HMAC-signed telemetry readings simulating acute ventricular tachycardia with hypoxia.
5. **Alert Fusion & Triage**: Correlates multiple rule and ML anomaly inputs into a single critical fused alert card.
6. **Executes Autonomous Protocol**: Medical officer completes ACLS microgravity resuscitation steps.
7. **Verifies Cryptographic Ledger**: Runs SHA-256 chain verification, proving zero record tampering.

---

## 2. Interactive Mission Console Walkthrough

### 2.1 Starting the Services

To run the full stack with the interactive React web dashboard:

```bash
# 1. Start backend, database, Redis, ML sidecar, and Prometheus/Grafana
docker compose up -d

# 2. Start the Mission Console Dashboard
cd dashboard
npm install
npm run dev
```

- **Mission Console Dashboard**: `http://localhost:3000`
- **Backend API & Swagger Docs**: `http://localhost:4000/docs`
- **Prometheus Metrics**: `http://localhost:4000/metrics` or `http://localhost:9090`
- **Grafana Observability**: `http://localhost:3001` (Credentials: `admin` / `astrocare_admin`)

---

## 3. Role-Based Verification Scenarios

The login screen features **one-click quick login buttons** for each operational persona to immediately test role-based access control and medical confidentiality.

### Scenario A: Flight Surgeon Evaluation
1. On the login screen, click **Dr. Sarah Connor (Flight Surgeon)**.
2. Navigate to **LIVE BIOMETRICS**:
   - Observe real-time vital cards for all crew members (`Ares-Lead`, `Ares-Medic`, `CREW-03`–`06`).
   - Switch between **Heart Rate** and **SpO2** streaming waveforms.
3. Navigate to **CLINICAL ALERTS**:
   - Notice the unredacted clinical triage cards showing rules fired, ML anomaly factor scores ($\sigma$-deviations), and resolution notes.
   - Click **Acknowledge** on open alerts.
   - Click **Snooze...** and select a snooze duration (15m, 30m, 1h, 2h) with clinical justification.
   - Click **Resolve...** and input treatment notes.

### Scenario B: Mission Control & Medical Confidentiality (NASA-STD-3001)
1. Click **Log out** in the top-right corner.
2. On the login screen, click **Gene Kranz (Flight Director - Mission Control)**.
3. Observe the purple **MISSION CONTROL** badge in the header.
4. Navigate to **CLINICAL ALERTS**:
   - Notice the prominent banner: `🔒 MISSION CONTROL CONFIDENTIALITY FILTER ACTIVE (NASA-STD-3001)`.
   - Observe that operational hazard tiers and affected vitals are displayed for flight safety awareness, but **clinical notes, diagnosis explanations, and doctor comments are redacted**: `[REDACTED MEDICAL CONFIDENTIAL - FLIGHT SURGEON ACCESS ONLY]`.
   - Notice that clinical triage buttons (Assign / Snooze) are hidden to prevent ground controller interference with medical officer decisions.

### Scenario C: Autonomous Onboard Mode & Blackout Survival
1. Click **Log out**, then log in as **Dr. Marcus Vance (System Admin)**.
2. Navigate to **COMMS DELAY & DTN**:
   - Check the **Force Comms Blackout** checkbox and click **Apply Simulation Override**.
   - Notice the top header immediately displays the flashing red alert banner: `DEEP SPACE COMMS BLACKOUT ACTIVE • SOLAR CONJUNCTION • AUTONOMOUS ONBOARD MODE ENGAGED`.
3. Switch to the **AUTONOMOUS GUIDANCE** tab:
   - Observe that the system status displays: `AUTONOMOUS MODE ENGAGED (LINK OFFLINE)`.
   - Browse the NASA-STD-3001 clinical checklists (Cardiovascular ACLS, Acute Hypoxia, Hypercapnia, Radiation SPE).
   - Check off steps (e.g. *Step 1: Crew Restraint Harness*, *Step 2: AED Deployment*, *Step 3: Medication Dosing*).
   - All actions are logged to the onboard cryptographic ledger for automatic ground synchronization when the link reconnects.

### Scenario D: Emergency Life-Safety Declaration
1. From any tab or screen, click the pulsing red **🚨 DECLARE EMERGENCY** button in the header.
2. In the confirmation modal:
   - Select Hazard Type: `Cardiac Arrest / Arrhythmia`.
   - Enter Situation Note: `Crew-01 acute cardiac event during EVA airlock ingress`.
   - Click **⚠️ BROADCAST EMERGENCY NOW**.
3. Observe the full-console emergency alarm banner flashing across all connected dashboard clients and Socket.IO channels.

---

## 4. Verification Commands Cheat Sheet

| Verification Task | Command | Expected Output |
| :--- | :--- | :--- |
| **Run Scripted Demo** | `make demo` or `npm run demo` | Complete scenario output, 0 errors, audit verified |
| **Backend Vitest Suite** | `cd backend && npm test` | All test files passing |
| **Ingestion Benchmark** | `cd backend && npm run bench:ingest` | Sustained rate $\ge 1,000$ readings/s (measured: $\sim 2,687$ r/s) |
| **Live Fanout Benchmark**| `cd backend && npm run bench:live` | 50 clients delivered in $< 3.0$ s (measured: $\sim 22$ ms) |
| **Audit Ledger Tamper Test** | `cd backend && npm run audit:verify` | Verified integrity; tamper detection proven |
| **Simulator Pytest** | `cd simulator && python -m pytest` | All determinism & bounds tests passing |
| **ML Sidecar Pytest** | `pytest ml-sidecar/tests -v` | Baseline & Isolation Forest tests passing |
| **Dashboard Build** | `cd dashboard && npm run build` | Clean Vite production bundle in `dist/` |
