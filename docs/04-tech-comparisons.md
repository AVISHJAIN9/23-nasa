# Technology Comparisons & Architectural Decisions

## 1. Database: MongoDB Time-Series vs InfluxDB vs TimescaleDB

| Comparison Factor | MongoDB 7 Time-Series (Used) | InfluxDB | TimescaleDB |
|---|---|---|---|
| **Data Model** | Unified Documents & Time-Series | Specialized TS Measurement | Relational SQL Hypertable |
| **Operational Simplicity** | Single DB for Users, Alerts & Vitals | Requires 2nd Database for Relational | Heavy PostgreSQL Ops |
| **Compression Ratio** | Columnar Snappy/Zstd | High Gorilla Compression | Good Compression |
| **Ad-Hoc JSON Schema** | High (Nested Device Sensors) | Poor for Complex JSON | Moderate |

- **Why MongoDB**: Allowed a single unified database deployment aboard the spacecraft habitat, eliminating the overhead of running both a time-series engine and a document store. [CONFIRM WITH DEVELOPER]

---

## 2. Event Streaming: Redis Streams vs Apache Kafka vs RabbitMQ

| Comparison Factor | Redis Streams (Used) | Apache Kafka | RabbitMQ |
|---|---|---|---|
| **Resource Overhead** | $<100MB$ RAM footprint | Heavy JVM ($>2GB$ RAM, ZooKeeper) | Moderate ($>300MB$) |
| **Sub-millisecond Latency**| Yes | Moderate | Yes |
| **Delay Buffering** | Native time-indexed stream reading | Partition offsets | Message TTL |

- **Why Redis Streams**: Minimal memory footprint ideal for embedded spacecraft servers while providing durable append-only log semantics.
