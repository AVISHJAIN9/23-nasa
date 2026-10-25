# AstroCare Machine Error Codes

This document lists all standardized error codes defined in the AstroCare backend catalog (F132 & Part 1b).
Every API error response carries one of these codes in the `error.code` string property.

---

## Error Code Registry

| Error Code | HTTP Status | Subclass | Description |
| :--- | :---: | :--- | :--- |
| `BAD_REQUEST` | **400** | `BadRequestError` | Syntax error in request, unparseable JSON payload, invalid query string, or payload size exceeded 1MB limit. |
| `UNAUTHENTICATED` | **401** | `UnauthenticatedError` | Authentication credentials missing, invalid Bearer token, wrong signature, missing/invalid `X-Ingest-Key`, or refresh token reuse detected. |
| `TOKEN_EXPIRED` | **401** | `TokenExpiredError` | JWT access token expiration timestamp has passed during ground/spacecraft synchronization. |
| `FORBIDDEN` | **403** | `ForbiddenError` | Authenticated crew member lacks required authorization role for the requested operation, or astronaut attempting to submit telemetry for another crew profile. |
| `NOT_FOUND` | **404** | `NotFoundError` | Requested endpoint or database entity does not exist. |
| `CONFLICT` | **409** | `ConflictError` | State collision (e.g. duplicate user email, re-used `Idempotency-Key` with conflicting payload, or concurrent idempotency lock). |
| `VALIDATION_ERROR` | **422** | `ValidationError` | Request body, query string, or path parameters failed Zod schema constraints, or all telemetry readings in batch rejected due to invalid crew IDs. Returns field-level `details`. |
| `RATE_LIMITED` | **429** | `RateLimitedError` | Account locked due to 5 consecutive failed login attempts (returns `Retry-After: <seconds>`), or communication burst exceeded. |
| `INTERNAL_ERROR` | **500** | `InternalError` | Unexpected server condition. Internal error messages and stack traces are suppressed for security; correlated by `request_id`. |
| `SERVICE_UNAVAILABLE` | **503** | `ServiceUnavailableError` | System readiness check failure (e.g. MongoDB disconnected, telemetry storage failure, Redis cache unreachable, or ML sidecar offline). |

---

## Wire Format Specification

```typescript
interface ErrorDetail {
  field: string; // Dotted property path (e.g. "body.spo2", "step", "role")
  issue: string; // Actionable description of the constraint failure
}

interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string; // RFC 4122 UUID v4
    details?: ErrorDetail[];
  };
}
```
