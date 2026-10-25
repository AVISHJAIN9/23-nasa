# AstroCare Alert Engine & Emergency Response (Part 2c / F063)

This document describes the Part 2c real-time alert bus, emergency state machine, and live distribution service for the AstroCare space medicine platform.

---

## 1. System Architecture

The Alert Engine connects raw telemetry anomaly detection, medical emergency declarations, and system notifications into a unified, high-reliability event streaming backbone.

```
+--------------------+        +---------------------+
| Telemetry Ingest   |        | Emergency Service   |
| (Rule Evaluators)  |        | (POST /v1/emergency)|
+---------+----------+        +----------+----------+
          |                              |
          v                              v
   +---------------+             +---------------+
   | alert.raised  |             | emergency.*   |
   | alert.updated |             | (declared,    |
   | alert.cleared |             |  acknowledged,|
   +-------+-------+             |  resolved,    |
           |                     |  cancelled)   |
           |                     +-------+-------+
           \                             /
            \                           /
             v                         v
       +------------------------------------+
       |         EventBus Interface         |
       |  (publish never throws; fail-open) |
       +-----------------+------------------+
                         |
           +-------------+-------------+
           | (Memory / Redis Streams)  |
           v                           v
     astro:events              Socket.IO /live
     (Stream replay)           (Audience projection)
```

---

## 2. Emergency State Machine (F063)

Medical emergencies represent urgent, time-critical life-support or acute medical situations declared by astronauts or ground surgeons.

### State Transitions
1. **`active`**: Initial state upon declaration via `POST /v1/emergencies`. Target delivery to flight surgeon within 3 seconds (under ISS/Moon comms link conditions).
2. **`acknowledged`**: When a flight surgeon or authorized medical crew acknowledges the emergency (`POST /v1/emergencies/:id/acknowledge`). Supports multi-user acknowledgment with `$addToSet`.
3. **`resolved`**: Condition stabilized or treated (`POST /v1/emergencies/:id/resolve`). Requires resolution summary.
4. **`cancelled`**: False alarm or accidental activation (`POST /v1/emergencies/:id/cancel`). Allowed only from `active` or `acknowledged`.

### Role-Based Access Matrix
| Role | Declare | Acknowledge | Resolve | Cancel | Read Detail |
|---|---|---|---|---|---|
| `astronaut` | Yes (Own crew) | Yes (Own crew) | No | Yes (Own crew) | Own crew |
| `flight_surgeon` | Yes (Any crew) | Yes (Any crew) | Yes | Yes | All crews |
| `mission_control`| No | Yes (Any crew) | No | No | Redacted free text |
| `admin` | Yes | Yes | Yes | Yes | All crews |

---

## 3. Real-Time Delivery & Role Projection

The `audience.ts` projection pipeline ensures medical privacy and flight-safety compliance:
- **Astronauts**: Access restricted to their assigned `crew_id`.
- **Mission Control**: Operational oversight; free-text medical notes and sensitive clinical explanations are redacted from payload envelopes.
- **Flight Surgeons & Admins**: Full unredacted clinical telemetry and timeline notes.

---

## 4. REST Endpoints

- `POST /v1/emergencies`: Declare an emergency.
- `GET /v1/emergencies/active`: List current unresolved emergencies.
- `GET /v1/emergencies/:id`: Get detailed emergency state with timeline.
- `POST /v1/emergencies/:id/acknowledge`: Acknowledge active emergency.
- `POST /v1/emergencies/:id/resolve`: Resolve emergency.
- `POST /v1/emergencies/:id/cancel`: Cancel emergency.
