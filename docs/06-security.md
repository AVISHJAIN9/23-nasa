# Security Audit: Spacecraft Telemetry Security

## Attack Surface & Mitigations
1. **Machine Authentication**: Machine endpoints require `X-Ingest-Key` validated using constant-time `crypto.timingSafeEqual` comparison against SHA-256 hashes to prevent timing attacks.
2. **Replay Attack Defense**: Idempotency keys with unique payload digests block replayed telemetry packets.
3. **Audit Ledger Integrity**: Audit events are cryptographically hashed and linked, creating an immutable ledger that reveals any local or ground record tampering.
4. **Data Redaction**: Telemetry transmitted to Earth is role-redacted to protect astronaut medical privacy under NASA flight surgeon regulations.
