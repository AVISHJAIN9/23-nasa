# Full Project Analysis: AstroCare Space-Medicine Platform

## 0.1 What the Project Is
**AstroCare** is an autonomous, delay-tolerant clinical decision-support and physiological vital monitoring platform designed for astronaut healthcare across the International Space Station (ISS), Lunar Artemis missions, and Deep-Space Mars expeditions.

In deep space, communication with Earth experiences up to 24 minutes of one-way light-time (OWLT) delay and frequent orbital blackout periods. Ground flight surgeons cannot provide real-time resuscitation guidance during medical emergencies. AstroCare solves this by running an autonomous, air-gapped clinical intelligence stack directly aboard the spacecraft LAN, providing immediate triage for crew medical officers while managing store-and-forward telemetry relays to Mission Control on Earth.

## 0.2 System Architecture Diagram

```mermaid
flowchart TB
    subgraph SpacecraftLAN["Spacecraft / Habitat Local Network (Zero Latency)"]
        Sensors[Bio-Sensors & Telemetry Simulators] -->|HTTP / Socket.IO| Ingest[Telemetry Ingest Engine]
        Ingest --> SQA[Signal Quality Analyzer]
        SQA --> TSDB[(MongoDB 7 Time-Series Readings)]
        
        SQA --> AlertRules[Clinical Threshold Engine]
        MLSidecar[Python ML Decompensation Sidecar] --> AlertRules
        AlertRules --> FusionEngine[Alert Fusion & Storm Suppression Engine]
        FusionEngine --> AuditStore[(Fused Alerts & Audit Ledger)]
        
        Astronaut[Crew Medical Officer / Astronaut] <-->|Sub-10ms Live Feed / Socket.IO| RealtimeBus[Local EventBus]
    end

    subgraph DelayRelay["Deep-Space Comms Delay Emulator"]
        RealtimeBus --> LinkEmulator[Comms Delay Emulator<br>ISS 0s | Moon 1.3s | Mars 3-22m]
        LinkEmulator --> BlackoutBuffer[(Ground Outbox & Blackout Queue)]
    end

    subgraph GroundControl["Earth Mission Control (Ground Segment)"]
        BlackoutBuffer --> GroundDelivery[Ground Delivery Bridge]
        GroundDelivery <-->|Delayed Projections & Redacted Telemetry| FlightSurgeons[Flight Surgeons & Mission Control]
    end
```

## 0.3 Final Inventory Counts
- **Total Backend Services**: 12 core micro-services (`ingest`, `quality`, `linkEmulator`, `fusionEngine`, `storeAndForward`, `mlClient`, etc.).
- **Backend Route Handlers**: 18 REST and Socket.IO namespaces.
- **Test Suites**: 49 Vitest test suites covering concurrency, security attacks, and delay emulation.
- **Database Collections**: 8 collections (Time-Series Vitals, Fused Alerts, Link State, Audit Ledger, Sessions).
- **ML Models**: 1 LightGBM/XGBoost predictive decompensation classifier in `ml-sidecar/`.
