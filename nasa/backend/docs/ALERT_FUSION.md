# AstroCare Alert Triage, Fusion & Inbox (Part 2d / F049 / F097)

This document serves as the architectural reference and frontend/ML intake guide for the Alert Triage, Fusion, and Medical Inbox subsystem.

---

## 1. Architectural Overview (F049)

Alert Fusion collapses disparate, noisy, and potentially contradictory clinical signals (vital signs threshold rules and external Python ML inference sidecars) into deduplicated, prioritized clinical cards grouped by:
```
group_key = "<crew_id>:<hazard>"
```

```
+-------------------+        +---------------------+
| 2b Rule Alerts    |        | External ML Sidecar |
| (HeartRate, SpO2) |        | POST /v1/alerts/ext |
+---------+---------+        +----------+----------+
          |                             |
          +--------------+--------------+
                         |
                         v
               +-------------------+
               | Keyed Serializer  | (1 promise queue per group_key)
               +---------+---------+
                         |
                         v
               +-------------------+
               |   FusionEngine    |
               | - Effective Sev   |
               | - Priority Score  |
               | - Deduplication   |
               | - Corroboration   |
               +---------+---------+
                         |
           +-------------+-------------+
           |                           |
           v                           v
   +---------------+           +---------------+
   | FusedAlert DB |           |  Inbox Event  |
   | (MongoDB)     |           | (EventBus)    |
   +---------------+           +---------------+
```

### Hazard Registry
- `cardiovascular`: `heart_rate`, `systolic`, `diastolic`
- `respiratory`: `spo2`, `resp_rate`
- `thermal`: `temp_c`
- `autonomic_stress`: `hrv_rmssd`
- `cabin_environment`: pressure, atmospheric composition
- `radiation`: cumulative and instantaneous dose (Part 2e)
- `general`: fallback for unmapped metrics

### Severity & Priority Math
- **Base Score**: `watch` = 10, `warning` = 40, `critical` = 80.
- **Corroboration Bonus**:
  - +10 per additional distinct source (e.g. Rule + ML).
  - +5 per additional distinct metric.
  - Maximum corroboration bonus is capped at +20.
- **Priority Key for Keyset Pagination**:
  - `priority_key = attention_weight * 1000 + priority_score`
  - Unresolved critical alerts always sort before warnings and watches.
- **ML Confidence Cap**:
  - Uncorroborated ML alerts with confidence < 0.5 are capped at `watch` severity.

---

## 2. External ML Sidecar Intake (`POST /v1/alerts/external`)

External Python ML microservices submit predictions without user JWTs using HTTP header authentication:
- **Header**: `X-ML-Key: <ASTRO_ML_API_KEY>` (compared in constant time).
- **Batch Processing**: Accepts 1 to 100 alerts per request.
- **Failure Isolation**: Valid items are accepted and enqueued; invalid items return 200 with rejection details in `rejected: [{ index, code, message }]`.

---

## 3. Clinical Workflow State Machine (F097)

```
        +---------------+
        |     open      |<--------------+ (snooze expired / higher severity)
        +-------+-------+               |
                |                       |
        +-------v-------+       +-------+-------+
        | acknowledged  |------>|    snoozed    |
        +-------+-------+       +---------------+
                |
        +-------v-------+
        |   resolved    | (manual or condition cleared)
        +---------------+
```

1. **`open`**: New alert raised or previous alert reopened due to higher severity member.
2. **`acknowledged`**: Medical officer or surgeon accepted responsibility.
3. **`snoozed`**: Temporarily suppressed for clinical observation. Max duration: 60m (`warning`), 480m (`watch`). Critical alerts cannot be snoozed.
4. **`resolved`**: Condition cleared or manually dismissed. Dismissing active condition suppresses alerts for `ASTRO_FUSION_DISMISS_SUPPRESS_S` (3600s).

---

## 4. REST API Summary

- `GET /v1/inbox`: Keyset-paginated list of fused alert cards.
- `GET /v1/inbox/summary`: Dashboard metrics (open, acknowledged, snoozed, critical unacknowledged).
- `GET /v1/inbox/:id`: Full detail view with member alerts, ML factors, and timeline.
- `POST /v1/inbox/:id/acknowledge`: Acknowledge alert.
- `POST /v1/inbox/:id/assign`: Assign alert to doctor.
- `POST /v1/inbox/:id/snooze`: Snooze alert.
- `POST /v1/inbox/:id/unsnooze`: Cancel active snooze.
- `POST /v1/inbox/:id/resolve`: Resolve alert.
- `POST /v1/inbox/:id/notes`: Append timeline clinical note.
- `POST /v1/alerts/external`: Batch intake for external ML sidecars.
