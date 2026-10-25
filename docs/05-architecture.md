# Architecture & Delay-Tolerant Networking (DTN)

## Planetary Delay Architecture

```mermaid
graph TD
    Sensor[Astronaut Bio-Sensors] -->|Local LAN| Ingest[AstroCare Ingest Engine]
    Ingest --> Quality[Signal Quality Analyzer]
    Quality --> TSDB[(MongoDB Time-Series)]
    Quality --> Fusion[Alert Fusion Engine]
    Fusion --> LocalClient[Local Crew Medic Dashboard (0ms)]

    Fusion --> DelayRouter{Comms Link Mode}
    DelayRouter -->|ISS| EarthDirect[Houston Mission Control (Real-Time)]
    DelayRouter -->|Mars Delay| RedisBuffer[(Redis Delay Stream)]
    
    subgraph "Time Delay Pipeline"
        RedisBuffer --> DelayWorker[Delay Worker (OWLT: 3-22 min)]
        DelayWorker --> GroundRelay[NASA Deep Space Network DSN]
    end

    GroundRelay --> EarthDashboard[Earth Flight Surgeons Dashboard]
```

## Fault Tolerance & Autonomous Recovery
The spacecraft node operates with 100% autonomy. If the physical Deep Space Network radio link drops, the application continues to provide local clinical alerts, vital trend analytics, and ML decompensation predictions without interruptions.
