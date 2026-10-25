# AstroCare Backend

> Space-medicine decision-support backend prototype for astronaut healthcare, vital monitoring, and autonomous tele-medicine under deep-space communication delays (Mars/Moon/ISS).

---

## Quickstart

### Prerequisites
- Node.js 20+ LTS
- MongoDB 7 (local or containerized)
- Redis 7 (optional for dev/test, required in prod)

### 1. Start MongoDB & Redis Locally
```bash
docker run -d --name astrocare-mongo -p 27017:27017 mongo:7
docker run -d --name astrocare-redis -p 6379:6379 redis:7
```

### 2. Environment Configuration
```bash
cp .env.example .env
# Set ASTRO_INGEST_API_KEY, ASTRO_REDIS_URL
```

### 3. Install & Seed Development Accounts
```bash
npm install
npm run seed:users
```

This provisions development accounts across all four roles:
- **Admin**: `admin@astrocare.nasa.gov` (`AdminSecret#2026`)
- **Flight Surgeon**: `surgeon@astrocare.nasa.gov` (`SurgeonSecret#2026`)
- **Mission Control**: `control@astrocare.nasa.gov` (`ControlSecret#2026`)
- **Astronaut**: `mercer@astrocare.nasa.gov` (`AstroSecret#2026`)
- **Crew Medical Officer**: `chen@astrocare.nasa.gov` (`MedicSecret#2026`)

### 4. Running Locally
```bash
npm run dev      # Start dev server with live reload (http://localhost:4000)
npm run build    # Strict TypeScript compilation
npm start        # Production start
```

### 5. Running Tests & Quality Gates
```bash
npm test          # Run Vitest test suite with MongoMemoryServer
npm run test:redis # Run Redis EventBus tests against local Redis
npm run lint      # Run ESLint checks
npm run format    # Format codebase with Prettier
npm run bench:ingest # Run high-throughput ingestion benchmark (>= 1,000 readings/s)
npm run bench:live   # Run real-time fan-out benchmark (50 clients under 3s SLA)
```

- **Interactive Swagger Docs**: `http://localhost:4000/docs`
- **OpenAPI 3.0 Contract**: `http://localhost:4000/v1/openapi.json`
- **Liveness Probe**: `http://localhost:4000/health`
- **Readiness Probe**: `http://localhost:4000/v1/health/ready`

---

## Developer Guide

### How to Protect a Route with Roles (< 10 lines)

```typescript
import { requireRole, requireMedicalAccess } from '../core/security.js';

// Enforce specific roles (e.g. Flight Surgeon or Admin):
router.get('/vitals', requireRole('flight_surgeon', 'admin'), getVitalsHandler);

// Enforce medical access (Flight Surgeon, Admin, or Crew Medical Officer):
router.post('/triage', requireMedicalAccess(), triageHandler);
```

---

### How to Throw an Error (< 10 lines)

Never format error JSON manually. Throw domain subclasses from `src/core/errors.ts`:

```typescript
import { NotFoundError, ForbiddenError } from '../core/errors.js';

if (!crewMember) {
  throw new NotFoundError(`Crew member '${id}' not found`);
}
```

---

### How to Add a New Router (< 10 lines)

Register all endpoints through `registerRoute()` to guarantee documentation integrity:

```typescript
import { Router } from 'express';
import { registerRoute } from '../../core/openapi.js';
import { z } from 'zod';

export function createV1ExampleRouter(): Router {
  const router = Router();
  registerRoute({
    method: 'get',
    path: '/v1/example',
    tags: ['Example'],
    summary: 'Example endpoint',
    successResponse: { status: 200, description: 'Success', schema: z.object({ ok: z.boolean() }) },
  });
  router.get('/', (_req, res) => res.json({ ok: true }));
  return router;
}
```

---

## Extension Points for Future Phases
- **Hash-Chained Audit Ledger (F124 / DB Teammate)**: Replace `MongoAuditWriter` in `src/core/audit.ts` with the tamper-evident hash-chained implementation behind the identical `AuditWriter` interface.
- **Redis-Backed Rate Limiting**: The account lockout logic in `src/routes/v1/auth.ts` currently tracks attempts on `User.failed_login_count`. The Redis teammate can swap or augment this with distributed token-bucket rate limiting without changing the `429 RATE_LIMITED` wire contract.
- **Socket.IO / Realtime WebSockets**: Socket connection handshakes can invoke `verifyAccessToken(socket.handshake.auth.token, secret)` directly from `src/core/tokens.ts`.
- **Automated Baseline Calculations**: The `baseline` subdocument in `src/models/CrewProfile.ts` is marked read-only on PATCH and is primed for the background analytics service to write computed baselines.
