# Architecture Decisions Log (ADR)

| Decision | Chosen Option | Alternative Considered | Deciding Factor |
|---|---|---|---|
| **Primary Engine** | Node.js 20 / TypeScript 5 | Python asyncio | High-concurrency WebSocket event loop and end-to-end typed contracts. |
| **Database** | MongoDB Time-Series | InfluxDB | Single unified database engine for vitals, documents, and alerts aboard spacecraft. |
| **Interplanetary Relay**| Store-and-Forward Outbox | Synchronous HTTP | Accommodates multi-minute light-time delay and planetary orbital blackouts. |
