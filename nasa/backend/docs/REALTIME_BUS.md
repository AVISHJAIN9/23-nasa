# AstroCare Real-Time Event Bus & Live Dashboards (F118 / F063)

This document serves as the frontend integration guide and backend reference for Part 2c, 2d, 2e, and 3c.

---

## 1. System Architecture

```
                   +----------------------------------+
                   | REST API Endpoints / Ingestion   |
                   | (POST /v1/emergencies, Ingest)   |
                   +-----------------+----------------+
                                     |
                                     v
                        +------------------------+
                        |   EventBus Interface   |
                        +-----------+------------+
                                    |
          +-------------------------+-------------------------+
          | (Normal Mode)                                     | (Degraded Mode)
          v                                                   v
+-------------------+                               +--------------------+
|   Redis Engine    |                               | In-Memory Outbox   |
| Streams: events   |                               | Local Fan-Out      |
| Pub/Sub: telemet. |                               | Background Flush   |
+---------+---------+                               +--------------------+
          |
          | (Dedicated Reader Connection)
          v
+-------------------------+
| Single-Instance Reader  |
| Resumes from last id    |
| Compares ms-seq IDs     |
+---------+---------------+
          |
          v
+-------------------------+
| Local Event Fan-out     |
| (canReceive + Projection|
|  + DeliveryPolicy Hook) |
+---------+---------------+
          |
          v
+-------------------------+
| Socket.IO /live Sockets |
| (Astronauts, Flight Surg|
|  Mission Control, Admin)|
+-------------------------+
```

### Why Redis Streams for Replayable Topics vs. Pub/Sub for Telemetry
1. **Redis Streams (`astro:events`)**:
   - Used for **alerts**, **emergency**, and **system** events.
   - Guaranteed sequential ordering and persistent retention (`MAXLEN ~ 10000`).
   - Supports `XRANGE` catch-up so disconnected dashboards can replay missed critical alerts and emergency declarations upon reconnect.
2. **Redis Pub/Sub (`astro:live:telemetry`)**:
   - Used for high-frequency (500ms coalesced) **telemetry** readings.
   - Fire-and-forget ephemeral broadcast. Never replayed.
   - Delivered to sockets using `socket.volatile.emit` so slow or lagging dashboards drop stale telemetry tiles rather than building memory backlogs.
3. **No `@socket.io/redis-adapter`**:
   - Each backend instance runs one dedicated reader loop on the shared stream and fans out directly to its local connected sockets.
   - This eliminates hidden state, simplifies scaling, and prevents dual-serialization overhead.

---

## 2. Event Envelope & Types

All events use snake_case JSON with ISO 8601 UTC timestamps ending in `Z`.

### Envelope Structure
```typescript
interface Envelope<T = Record<string, unknown>> {
  uid: string;            // UUID v4 generated at publish; client dedupe key
  id: string | null;      // Monotonic stream ID ("<ms>-<seq>") or null if degraded/ephemeral
  topic: 'alerts' | 'emergency' | 'system' | 'telemetry';
  type: string;           // E.g. 'emergency.declared', 'alert.raised', 'telemetry.update'
  crew_id?: string | null;
  severity?: 'info' | 'warning' | 'critical' | null;
  audience: 'all' | 'crew' | 'ground';
  emitted_at: string;     // ISO 8601 UTC
  mission_mode: 'iss' | 'moon' | 'mars';
  request_id?: string | null;
  payload: T;
}
```

### Event Catalog Table

| Topic | Event Type | Payload Format | Description |
| :--- | :--- | :--- | :--- |
| `emergency` | `emergency.declared` | `EmergencyDTO` | Astronaut or Admin declares a critical operational/medical emergency. |
| `emergency` | `emergency.acknowledged`| `EmergencyDTO` | Emergency acknowledged by ground or medical crew. |
| `emergency` | `emergency.resolved` | `EmergencyDTO` | Flight surgeon or Admin marked emergency resolved. |
| `emergency` | `emergency.cancelled` | `EmergencyDTO` | Declaring astronaut or Admin cancelled false alarm. |
| `alerts` | `alert.raised` | `AlertDTO` | Clinical threshold alert raised by the decision support engine. |
| `alerts` | `alert.updated` | `AlertDTO` | Alert severity or physiological progression updated. |
| `alerts` | `alert.cleared` | `AlertDTO` | Vital sign returned to safe baseline. |
| `telemetry` | `telemetry.update` | `{ crew_id, timestamp, values }` | Ephemeral 500ms coalesced vital metrics with quality flags. |
| `system` | `system.notice` | `{ message, level }` | Reserved for scenario triggers and platform notices. |

### Example: Emergency Declared JSON
```json
{
  "uid": "a6b6c085-b8ee-449e-b952-4467d3ec0747",
  "id": "1773812400000-0",
  "topic": "emergency",
  "type": "emergency.declared",
  "crew_id": "6710d1fa98a1230012345678",
  "severity": "critical",
  "audience": "all",
  "emitted_at": "2026-10-18T10:15:00.000Z",
  "mission_mode": "mars",
  "request_id": "9a1bdb04-e405-4065-83be-753ca17f8010",
  "payload": {
    "id": "6710d1fa98a1230012345679",
    "crew_id": "6710d1fa98a1230012345678",
    "declared_by": "6710d1fa98a1230012345670",
    "type": "cardiac",
    "note": "Sudden onset ventricular tachycardia during EVA egress",
    "source": "button",
    "status": "active",
    "declared_at": "2026-10-18T10:15:00.000Z",
    "acknowledged_by": [],
    "mission_mode": "mars",
    "client_request_id": "d8b2e1b4-5f5a-4b9b-8f3a-1d1a1b1c1d1e"
  }
}
```

---

## 3. Socket.IO `/live` Namespace & Replay Protocol

Connect to the `/live` namespace on the AstroCare backend.

### Handshake Auth Options
```typescript
{
  token: string,           // Current JWT access token
  last_event_id?: string   // Last received non-null event.id ("<ms>-<seq>")
}
```

### Handshake Sequence
```
Client                                     Server (/live)
  |                                              |
  |--- Connect { token, last_event_id: null }--->| (Cold start)
  |<-- "hello" { head_id, server_time } ---------|
  |                                              |
  |--- [Network Interruption]                    |
  |                                              |
  |--- Connect { token, last_event_id: "..." }-->| (Reconnect)
  |<-- "replay:begin" { from_id, head_id } ------|
  |<-- "event" [Missed Event 1] -----------------|
  |<-- "event" [Missed Event 2] -----------------|
  |<-- "replay:end" { count: 2, last_id } -------|
  |<-- "event" [Live Events continue...] --------|
```

### Buffer-Before-Replay Handoff
To eliminate gaps and race-condition duplicates during reconnects:
1. On socket connection, the server **immediately begins buffering incoming live events**.
2. It fetches and streams the replay from `last_event_id` to current stream head.
3. Once replay finishes, the buffered live events are flushed, skipping any ID `<= last_sent_id` or any `uid` already received.
4. Clients perform local deduplication using the `event.uid` property.

---

## 4. Frontend Integration Snippet (Ready to Paste)

```typescript
import { io, Socket } from 'socket.io-client';

export interface AstroLiveClientOptions {
  url: string;
  getAccessToken: () => Promise<string> | string;
  onEvent: (event: any) => void;
  onResyncRequired: (endpoints: string[]) => void;
  onAuthExpired: () => void;
}

export function connectAstroLive(options: AstroLiveClientOptions): Socket {
  let storedLastEventId: string | null = null;
  const processedUids = new Set<string>();

  const socket = io(`${options.url}/live`, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
    // Dynamic auth function: evaluates fresh token & last_event_id on every reconnect
    auth: async (cb) => {
      try {
        const token = await options.getAccessToken();
        cb({
          token,
          last_event_id: storedLastEventId,
        });
      } catch (err) {
        cb({ token: '' });
      }
    },
  });

  socket.on('hello', (data: { head_id: string | null }) => {
    if (data.head_id) {
      storedLastEventId = data.head_id;
    }
  });

  socket.on('replay:begin', () => {
    console.debug('[AstroLive] Catch-up replay started');
  });

  socket.on('event', (envelope: any) => {
    // Client-side deduplication
    if (processedUids.has(envelope.uid)) return;
    processedUids.add(envelope.uid);
    if (processedUids.size > 2000) {
      const oldest = processedUids.values().next().value;
      if (oldest) processedUids.delete(oldest);
    }

    if (envelope.id) {
      storedLastEventId = envelope.id;
    }

    options.onEvent(envelope);
  });

  socket.on('replay:resync', (data: { reason: string; resync: string[] }) => {
    console.warn(`[AstroLive] Replay gap (${data.reason}). Resyncing via REST:`, data.resync);
    options.onResyncRequired(data.resync);
  });

  socket.on('auth:expiring', async () => {
    try {
      const freshToken = await options.getAccessToken();
      socket.emit('auth:refresh', { token: freshToken }, (ack: any) => {
        if (!ack?.ok) {
          console.warn('[AstroLive] Token refresh failed:', ack?.error);
        }
      });
    } catch {
      // fallback to disconnect
    }
  });

  socket.on('auth:expired', () => {
    options.onAuthExpired();
  });

  socket.on('connect_error', (err: any) => {
    if (err.data?.code === 'TOKEN_EXPIRED') {
      options.onAuthExpired();
    }
  });

  return socket;
}
```

---

## 5. Emergency Declaration (F063)

### State Machine

```
              POST /v1/emergencies
                       |
                       v
                 [ ACTIVE ] <-----------+
                   |    |                | (Further Acks append
      Acknowledge  |    | Cancel         |  to acknowledged_by)
                   v    v                |
           [ ACKNOWLEDGED ] -------------+
                   |    |
          Resolve  |    | Cancel
                   v    v
       [ RESOLVED ]      [ CANCELLED ]
      (Terminal)          (Terminal)
```

- **Transitions**:
  - `active` -> `acknowledged`: First acknowledgment.
  - `acknowledged` -> `acknowledged`: Additional crew/ground acknowledgments append idempotently.
  - `active` or `acknowledged` -> `resolved`: Clinical or operational resolution (Flight Surgeon or Admin only).
  - `active` or `acknowledged` -> `cancelled`: Erroneous declaration cancelled by declaring astronaut within `ASTRO_EMERGENCY_CANCEL_WINDOW_S` (default 60s) or Admin anytime.
  - Terminal states (`resolved`, `cancelled`) reject any transition with `409 CONFLICT`.

### REST Endpoints
- `POST /v1/emergencies`: Declare emergency (Astronaut, Admin).
- `GET /v1/emergencies`: Cursor-paginated emergencies. Role projected.
- `GET /v1/emergencies/:id`: Fetch emergency details. Role projected.
- `POST /v1/emergencies/:id/acknowledge`: Acknowledge active emergency.
- `POST /v1/emergencies/:id/resolve`: Resolve emergency (Surgeon, Admin).
- `POST /v1/emergencies/:id/cancel`: Cancel false alarm (Declaring astronaut in window, Admin).

---

## 6. Integration Extension Points for Future Parts

| Component | Target Part | How to Hook In |
| :--- | :---: | :--- |
| **Alert Engine / Fusion** | **Part 2d** | Subscribe directly to in-process `alertPublisher.subscribe(...)` for low latency, or `eventBus.subscribe(..., { topics: ['alerts'] })`. |
| **Comms Delay Emulator** | **Part 2e** | Inject a custom `DeliveryPolicy` implementation into `createApp({ deliveryPolicy })` and `createSocketServer`. Return Mars/Moon delay (ms) for role `'mission_control'` and `'flight_surgeon'`. |
| **Scenario Runner** | **Part 2f** | Inject automated training alerts using `eventBus.publish({ topic: 'system', type: 'system.notice', ... })`. |
| **Emergency Protocols** | **Part 3c** | The `Emergency` model includes an allocated `protocol_id: string | null` field reserved for attaching the protocol runner state. |

---

## 7. Known Limitations

1. **Events are Notifications, Not Canonical State**: MongoDB remains the single source of truth for alerts and emergencies. If a client receives a `replay:resync` notice, it refetches active entities through the REST endpoints.
2. **Approximate Stream Trimming**: Redis Streams use `MAXLEN ~ 10000` to avoid continuous memory reallocation. Old events beyond 10,000 entries are trimmed.
3. **Degraded Mode Outbox**: If Redis is offline, the backend delivers events locally with `id: null` and queues them in a bounded FIFO outbox (default 1000 items). When Redis returns, events are flushed in order. Overflow drops the oldest items and emits error logs.
