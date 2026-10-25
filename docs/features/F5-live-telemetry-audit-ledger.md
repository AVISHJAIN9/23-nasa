# F5: Local Live Streaming & Audit Ledger

## Overview
Zero-latency Socket.IO delivery on the spacecraft LAN paired with an HMAC-chained audit log for post-mission forensic verification.

## Say It Out Loud
> "For immediate emergency response, `liveService.ts` broadcasts raw telemetry and fused alerts over local Socket.IO rooms with sub-10 millisecond latency, while maintaining a tamper-evident audit trail for ground surgeons."
