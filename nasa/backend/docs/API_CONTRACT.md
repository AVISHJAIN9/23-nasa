# AstroCare API Contract & Engineering Standards

> **Audience**: All AstroCare backend engineers and MERN contributors.
> Every convention established in this document is authoritative and must be strictly followed by all services.

---

## 1. Gateway & URL Structure

- **Base URL Prefix**: All business routes reside strictly under `/v1` (e.g. `/v1/auth`, `/v1/users`, `/v1/crew`, `/v1/onboarding`, `/v1/flags`, `/v1/health/ready`).
- **Liveness Probe**: `/health` is exposed at the root level outside `/v1` for load-balancer health checks.
- **Interactive Documentation**: Swagger UI is accessible at `/docs`.
- **OpenAPI 3.0 Contract Specification**: Machine-readable JSON spec is served at `/v1/openapi.json`.
- **Versioning Policy**:
  - Additive, non-breaking modifications (new fields, new endpoints) remain within `/v1`.
  - Breaking schema modifications (field removals, type shifts, altered semantic behaviors) require a new `/v2` mount.

---

## 2. Authentication & Session Architecture (F001)

### Token Lifetimes & Rotation
- **Access Tokens**: Short-lived JWTs signed with **HS256** (default TTL: **15 minutes**).
  - Claims: `sub` (User ID), `role` (`astronaut` | `flight_surgeon` | `mission_control` | `admin`), `mo` (boolean: Crew Medical Officer), `iat`, `exp`.
  - Transmitted via the HTTP `Authorization: Bearer <token>` header.
- **Refresh Tokens**: Opaque cryptographically random strings (default TTL: **7 days**).
  - Stored only as SHA-256 hashes in MongoDB (`refresh_tokens` collection) with MongoDB TTL indexing.
  - Delivered exclusively in an `httpOnly`, `SameSite=Lax`, `Secure` (in production) cookie scoped to `Path=/v1/auth`.
- **Refresh Token Rotation & Theft Detection**:
  - Every call to `POST /v1/auth/refresh` consumes the active token, marks it used, and returns a rotated refresh token in the cookie within the same `family_id`.
  - If an already-used or revoked refresh token is presented, the system detects a token replay attack and immediately revokes all tokens within that `family_id`, returning `401 UNAUTHENTICATED`.
- **Access-Token Staleness Window**:
  - Access tokens are stateless. Administrative updates to roles, account statuses, or medical officer designations take effect when the client requests a new access token via `/v1/auth/refresh` (maximum staleness: 15 minutes, or immediately upon manual re-login).

### Account Lockout Policy
- 5 consecutive failed login attempts trigger an automatic account lockout for **15 minutes**.
- The API responds with `429 RATE_LIMITED` and attaches an HTTP `Retry-After: <seconds>` header.
- A successful login immediately resets the failure counter to zero.

---

## 3. Role-Based Access Control (RBAC) Matrix

The system recognizes four discrete crew and mission operations roles:
`Role = "astronaut" | "flight_surgeon" | "mission_control" | "admin"`.

| Endpoint | Method | Required Role / Authorization | Description |
| :--- | :---: | :--- | :--- |
| `/v1/auth/login` | `POST` | Public | Crew authentication |
| `/v1/auth/refresh` | `POST` | Public (Requires Cookie) | Token family rotation |
| `/v1/auth/logout` | `POST` | Public | Revokes refresh family & clears cookie |
| `/v1/auth/me` | `GET` | Authenticated | Inspects current caller identity |
| `/v1/users` | `POST` | `admin` | Provisions new user accounts |
| `/v1/users` | `GET` | `admin` | Lists users (paginated) |
| `/v1/users/:id` | `PATCH` | `admin` | Modifies user attributes / status |
| `/v1/users/:id/medical-officer` | `PUT` | `admin` | Toggles MO status for astronauts (audited) |
| `/v1/crew` | `POST` | `admin` | Creates physiological crew baseline |
| `/v1/crew` | `GET` | `flight_surgeon`, `mission_control`, `admin` | Lists crew profiles (redacts `medical_history` for `mission_control`) |
| `/v1/crew/:id` | `GET` | Self (Astronaut) OR `flight_surgeon`, `mission_control`, `admin` | Reads crew profile (redacts `medical_history` for `mission_control`) |
| `/v1/crew/:id` | `PATCH` | Self (Astronaut) OR `admin` | Updates non-baseline fields (`baseline` is immutable here) |
| `/v1/crew/:id` | `DELETE` | `admin` | Deletes crew profile |
| `/v1/onboarding/status` | `GET` | Authenticated (Astronaut/Self) | Current onboarding milestone & `next_step` |
| `/v1/onboarding/status` | `PATCH` | Authenticated (Astronaut/Self) | Updates `consent_acknowledged` or `profile_completed` |
| `/v1/onboarding/status/:userId`| `GET` | `admin` | Audits astronaut onboarding milestone |
| `/v1/telemetry` | `POST` | Machine (`X-Ingest-Key`) OR `admin` / `astronaut` (Self) | Ingests vital telemetry batch with quality evaluation & idempotency |
| `/v1/crew/:id/telemetry/latest` | `GET` | Self (Astronaut) OR `flight_surgeon`, `mission_control`, `admin` | Reads most recent reading and latest ok reading per metric |
| `/v1/flags` | `GET` | Public | Lists feature flags |
| `/v1/flags/:name` | `PUT` | `admin` | Modifies runtime feature flags |
| `/v1/health/ready` | `GET` | Public | Subsystem readiness probe |

---

## 4. Payload & Data Formatting Conventions

1. **Casing**: All JSON object keys, query parameters, and URL path variables must use `snake_case`.
2. **Timestamps**:
   - All timestamps must be ISO 8601 formatted strings in UTC ending with `Z` (e.g. `2026-10-17T18:00:00.000Z`).
   - Mission-critical payloads carry the temporal `MissionTime` schema (`timestamp` and integer `mission_day`).
3. **Identifiers**:
   - Entity IDs are opaque strings (MongoDB 24-character hexadecimal `ObjectId`).
   - `request_id` values are standard RFC 4122 UUID v4 strings.
4. **Pagination**:
   - Cursor-based pagination with query parameters `limit` (integer) and `cursor` (opaque string).
   - Responses follow the `Page<T>` schema: `{ "items": [ ... ], "next_cursor": "eyJpZCI6IjY3MTBkMWZhIn0=" }`.

---

## 5. Unified Error Contract (F132)

Every non-2xx HTTP response conforms strictly to:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable explanation of what went wrong",
    "request_id": "8e36fa7c-2b5d-4f16-9ea3-9e451b6890f1",
    "details": [
      {
        "field": "body.spo2",
        "issue": "must be between 70 and 100"
      }
    ]
  }
}
```

---

## 6. How to Protect Routes in One Line

```typescript
import { requireRole, requireMedicalAccess, requireSelfOrRole } from '../core/security.js';

// Admin only:
router.post('/deploy', requireRole('admin'), handler);

// Multi-role clearance:
router.get('/vitals', requireRole('flight_surgeon', 'admin'), handler);

// Medical clearance (Flight Surgeon, Admin, or Astronaut designated as Medical Officer):
router.post('/triage', requireMedicalAccess(), handler);

// Self-access or authorized role:
router.get('/crew/:id', requireSelfOrRole('id', 'flight_surgeon', 'admin'), handler);
```

---

## 7. Telemetry Ingestion, Machine Auth & Signal Quality (F013 & F019)

### Machine Authentication
- Automated simulator services authenticate using the **`X-Ingest-Key`** HTTP header or `{ ingest_key }` in Socket.IO handshake auth.
- Comparison is performed using length-safe, constant-time `crypto.timingSafeEqual` over SHA-256 digests.
- Service callers with a valid key are authorized to write telemetry for any crew member.
- User callers authenticate via Bearer JWT: `admin` may ingest for any crew; `astronaut` may only ingest for their own linked crew profile.

### Idempotency & Retries
- Resolves key priority: `Idempotency-Key` header -> body `batch_id` -> SHA-256 hash of canonical JSON payload.
- Completed transactions replayed with identical payload return the cached response with header **`Idempotency-Replayed: true`** without duplicate writes.
- Same key sent with different payload returns **`409 CONFLICT`**.
- Concurrent requests finding a "processing" record return **`409 CONFLICT`** with Retry-After hint, unless the lease is older than 60 seconds (lease takeover rule).

### Signal Quality Flags
Every stored reading carries `{ flag, reasons: [] }`:
- `ok`: Valid, continuous, physiologically plausible reading. **Only "ok" readings may raise clinical alerts (Part 2b).**
- `dropout`: Missing reading (`value: null`).
- `implausible`: Outside physiological bounds (e.g. HR < 20 or > 250 bpm; sentinel -999). Plausibility indicates sensor validity, not clinical alert thresholds (SpO2 of 60% remains `"ok"`).
- `spike`: Rate of change exceeds configured max rate. Three consecutive consistent readings trigger genuine level shift acceptance (`"ok"` with reason `level_shift_accepted`).
- `flatline`: Reading unchanged within epsilon for `>= flatline_window_s` in reading time.
- `interpolated`: Automatically filled missing data for gaps `> 1.5x expected_interval` and `<= ASTRO_TELEMETRY_MAX_INTERP_GAP_S`. Longer gaps are reported in response `gaps`.

---

## 8. Emergency Management (F063)

### Endpoints
- `POST /v1/emergencies`: Declare emergency. Authorized: `astronaut` (own crew only), `admin` (any crew).
  - Body: `{ crew_id?, type, note?, source?, client_request_id }`
  - Idempotent by `client_request_id` (returns 200 on retry).
  - Deduplicated within `ASTRO_EMERGENCY_DEDUPE_S` for identical type and crew (returns 200 with `deduplicated: true`).
  - Broadcasts critical emergency event to dashboards in under 3 seconds.
- `GET /v1/emergencies`: Paginated list of emergencies.
  - Astronauts only see emergencies for their linked crew.
  - Mission Control sees all emergencies, but free-text notes are redacted.
  - Flight Surgeon and Admin see all fields.
- `GET /v1/emergencies/:id`: Details for a specific emergency.
- `POST /v1/emergencies/:id/acknowledge`: Acknowledge emergency. Authorized: all authenticated roles.
- `POST /v1/emergencies/:id/resolve`: Resolve emergency. Authorized: `flight_surgeon`, `admin`.
- `POST /v1/emergencies/:id/cancel`: Cancel emergency. Authorized: declaring `astronaut` within `ASTRO_EMERGENCY_CANCEL_WINDOW_S`, or `admin` anytime.

---

## 9. Real-Time Event Bus & Live Dashboards (F118)

### Socket.IO `/live` Namespace
- Handshake auth: `{ token, last_event_id? }`.
- Live events delivered on `"event"` channel using the envelope format.
- Missed events replayed between `"replay:begin"` and `"replay:end"`.
- Token refreshed via `"auth:refresh"` after receiving `"auth:expiring"`.
- Volatile delivery for telemetry updates.

### REST Replay Fallback
- `GET /v1/events?after=<id>&limit=<n>&topic=<topic>`:
  - Fallback endpoint when WebSocket connection is unavailable.
  - Replays stream events strictly after `<id>`.
  - Rejects ephemeral `telemetry` topic.
  - Applies role authorization and projection identical to WebSocket stream.

---

## 10. Alert Inbox & Clinical Workflow (F097)

### Endpoints
- `GET /v1/inbox`: Keyset-paginated list of fused alert cards.
  - Query params: `status`, `severity`, `hazard`, `source`, `condition`, `assignee`, `needs_attention`, `limit`, `cursor`.
  - Astronauts are strictly scoped to their own crew.
  - Non-medical roles receive projected views with clinical notes redacted.
- `GET /v1/inbox/summary`: Aggregate counts by status, severity, unacknowledged critical count, and top priority crews.
- `GET /v1/inbox/:id`: Detailed card view with members, ML factors, explanation, timeline, and resolution info.
- `POST /v1/inbox/:id/acknowledge`: Acknowledge card. Transitions from `open` or `snoozed` to `acknowledged`.
- `POST /v1/inbox/:id/assign`: Assign card to doctor (`flight_surgeon`, `admin`, or medical-officer astronaut).
- `POST /v1/inbox/:id/snooze`: Snooze card with clinical duration and mandatory reason. Critical cards cannot be snoozed.
- `POST /v1/inbox/:id/unsnooze`: Cancel active snooze, returning card to `open`.
- `POST /v1/inbox/:id/resolve`: Resolve card. Mandatory `resolution_note` (>=10 chars) if condition is active.
- `POST /v1/inbox/:id/notes`: Append free-text note (max 1000 chars) to alert timeline.

---

## 11. External ML Sidecar Alerts (F049)

### Endpoints
- `POST /v1/alerts/external`: Batch intake endpoint for Python ML inference sidecars.
  - Authenticated via HTTP header `X-ML-Key` (no JWT required).
  - Accepts batch of 1 to 100 items.
  - Returns `{ received, accepted, rejected: [{ index, code, message }] }`.
  - Enqueues valid items to the Alert Fusion Engine.

