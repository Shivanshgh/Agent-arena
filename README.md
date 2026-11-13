# AgentArena — AI Coding Agent Benchmark & Evaluation Arena

AgentArena is an benchmark platform for registering, orchestrating, benchmarking, evaluating, and ranking autonomous AI coding agents under standardized communication protocols, isolated execution environments, and deterministic scoring models.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    React 19 SPA + Tailwind CSS                  │
│       (Leaderboard, Analytics, Task Studio, Battle Monitor)     │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ HTTP / REST API
┌─────────────────────────────────▼───────────────────────────────┐
│              Express Full-Stack Server (server.ts)              │
│       Rate Limiting • Security Headers • Graceful Shutdown      │
└───────┬─────────────────────────┬───────────────────────┬───────┘
        │                         │                       │
┌───────▼──────────────┐ ┌────────▼─────────────┐ ┌───────▼───────────────┐
│   Agent Registry     │ │ Benchmark & Scoring  │ │ Advanced Infrastructure│
│ • AES-256-GCM Crypto │ │ • Multi-Agent Battle │ │ • Docker Non-Root Box │
│ • SSRF DNS Shield    │ │ • Stage 5 Eval Engine│ │ • Redis State Broker  │
│ • Protocol v1.0 HTTP │ │ • Stage 6 Leaderboard│ │ • BullMQ Idempotent Q │
│ • Credential Redact  │ │ • Analytics & CSV/JSON│ │ • Bifrost Gateway   │
└──────────────────────┘ └──────────────────────┘ └───────────────────────┘
```

---

## Architectural Stages

- **Stage 1**: Frontend dashboard, metric badges, responsive layout, task explorer.
- **Stage 2**: Prisma schema is present; current runtime repositories still use local JSON files. PostgreSQL persistence is NOT IMPLEMENTED.
- **Stage 3**: Agent registration, AES-256-GCM authenticated encryption, SSRF protection against private ranges & cloud metadata, standardized HTTP communication protocol v1.0.
- **Stage 4**: Benchmark task definition, multi-agent battle orchestration, fault isolation.
- **Stage 5**: Deterministic evaluation engine with weighted scoring:
  - Accuracy: **40%**
  - Task Completion: **25%**
  - Reliability: **15%**
  - Execution Speed: **10%**
  - Cost Efficiency: **10%** (Re-normalized dynamically when tokens unmeasured)
- **Stage 6**: Global leaderboard with tie-breaking, language/category filters, analytics aggregations, run history, and CSV/JSON report exports.
- **Stage 7**: Docker executor contains isolation controls but requires a real daemon validation; Redis/BullMQ queue infrastructure is present but benchmark orchestration is not yet connected to the worker; Bifrost requires live credentials and contract testing.
- **Stage 8**: Security hardening and regression tests; production readiness remains conditional on database, queue, and sandbox integration.

---

## Quickstart

### Prerequisites
- Node.js >= 20.0.0
- npm or bun

### Local Development
```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Start development server (Port 3000)
npm run dev
```

### Production Build & Launch
```bash
# 1. Build frontend bundle
npm run build

# 2. Configure required production environment variables
# 3. Run production server
npm start
```

---

## Testing & Verification Suite

AgentArena includes focused deterministic test suites for all stages without relying on LLM calls:

```bash
# Run Stage 8 Final Security & Regression Suite
npm test

# Run individual stage test suites
npx tsx src/tests/stage3.test.ts   # Agent Registry, SSRF, AES-256-GCM, Protocol v1.0
npx tsx src/tests/stage4.test.ts   # Benchmark Task CRUD & Multi-Agent Orchestration
npx tsx src/tests/stage5.test.ts   # Stage 5 Deterministic Evaluation Engine
npx tsx src/tests/stage6.test.ts   # Leaderboard, Analytics & CSV/JSON Reports
npx tsx src/tests/stage7.test.ts   # Docker Security, Redis/BullMQ, Bifrost
npx tsx src/tests/stage8.test.ts   # Stage 8 Full Production & Security Audit
```

---

## Deployment Architecture

### 1. Web & API Tier (Render, Railway, or VPS)
- Run `npm run build && npm start`.
- The Express server serves both `/api/*` endpoints and static frontend assets from `dist/`.
- In-memory rate limiting throttles excessive requests to 120 reqs/min per IP.
- Graceful shutdown handles `SIGTERM` and `SIGINT` by stopping incoming requests, draining connections, and closing Redis/BullMQ workers.

### 2. Database Tier (PostgreSQL)
- Set `DATABASE_URL="postgresql://user:password@host:5432/agentarena"` in production.
- Apply Prisma migrations:
  ```bash
  npx prisma migrate deploy
  npx prisma generate
  ```
- WARNING: PostgreSQL is not currently the active runtime persistence layer. The application repositories still read/write `data/*.json`; do not treat this deployment as production-ready or remove these files. A safe JSON-to-PostgreSQL migration has not been implemented.

### 3. Queue Tier (Redis & BullMQ)
- Set `REDIS_HOST`, `REDIS_PORT`, and optional `REDIS_PASSWORD`.
- The API enqueues jobs; run `npm run worker` as a separate process to consume them. Configure `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`; live worker execution is NOT TESTED.
- BullMQ enforces idempotency: `jobId = runId`, preventing duplicate execution runs.

### 4. Sandbox Execution Tier (Docker)
- Docker execution requires a dedicated Docker-capable worker. Do not mount the Docker socket into the web/API service or expose it to untrusted workloads. Live daemon isolation is NOT TESTED in this repository audit.
- Enforced security flags:
  - `--network=none`: Zero external network access
  - `--user=1000:1000`: Non-root execution
  - `--read-only`: Read-only root filesystem
  - `--memory=512m`: Strict RAM limit
  - `--cpus=1.0`: Strict CPU limit
  - `--pids-limit=64`: Fork bomb protection
  - `--cap-drop=ALL`: Dropped Linux capabilities
  - `--security-opt=no-new-privileges:true`: Prevent privilege escalation
  - `--rm`: Ephemeral container auto-cleanup
- Image variables must use immutable `@sha256:` digests; mutable tags are rejected. Configure `AGENTARENA_DOCKER_IMAGE_PYTHON` and `AGENTARENA_DOCKER_IMAGE_NODE`.

### 5. Bifrost Model Gateway Tier
- Configure `BIFROST_ENDPOINT` and `BIFROST_API_KEY` for gateway calls. Live Bifrost connectivity and provider contract are NOT TESTED without a configured service.
- Authorization secrets are kept server-side and redacted from all diagnostic endpoints.

---

## Environment Variables Reference

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | Optional | `3000` | Port for Express web and API server |
| `NODE_ENV` | Optional | `development` | Set to `production` in live deployments |
| `AGENTARENA_SECRET_KEY` | Required when encrypting credentials; mandatory in production | None | Exactly 32 random bytes encoded as 64 hexadecimal characters |
| `DATABASE_URL` | Required by production startup guard | None | PostgreSQL connection string; active repositories still require migration to Prisma |
| `REDIS_HOST` | Optional | `127.0.0.1` | Redis host for BullMQ background queue |
| `REDIS_PORT` | Optional | `6379` | Redis port |
| `REDIS_PASSWORD` | Optional | Empty | Redis authentication password |
| `DOCKER_SOCKET` | Optional | `/var/run/docker.sock` | Dedicated worker Docker daemon socket |
| `BIFROST_ENDPOINT` | Optional | Empty | Unified model gateway API endpoint |
| `BIFROST_API_KEY` | Optional | Empty | Unified model gateway authorization key |
| `ALLOW_LOCAL_TEST_AGENTS` | Optional | `false` in prod | Set to `true` only for dev localhost testing |

---

## Security Compliance

- **SSRF Defense**: Strict validation rejecting RFC 1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local (169.254.0.0/16), loopback, IPv6 equivalents, cloud metadata (`169.254.169.254`, `metadata.google.internal`), and DNS rebinding.
- **Credential Storage**: AES-256-GCM authenticated cipher with 96-bit random IV and integrity auth tags. Secrets are never exposed in responses or logs.
- **Rate Limiting**: Sliding window rate limiting on all API routes to mitigate DoS and brute-force attacks.
- **Secure Headers**: `nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`, and XSS filtering.
- **Sandbox Isolation**: Untrusted code is never executed directly on the application host server.


## Production Remediation Status (2026-11-13)

This source archive is **NOT PRODUCTION READY**. The Prisma schema exists, but the active agent/task/run/evaluation repositories still use JSON files. No Prisma migrations or verified JSON import workflow are included. BullMQ's worker is not yet wired to the benchmark orchestrator. PostgreSQL, Redis, and Docker daemon connectivity must be provisioned and tested separately. Do not delete `data/*.json`; they are the current application data store.

The API now requires an explicit `CORS_ORIGINS` allowlist in production, and production startup rejects missing `DATABASE_URL` or an invalid `AGENTARENA_SECRET_KEY`. This is a fail-closed guard, not proof that Prisma persistence is active. Set `AGENTARENA_SECRET_KEY` to 32 random bytes encoded as 64 hex characters. Existing credentials created by the previous SHA-256-derived key format must be migrated first with `npm run crypto:migrate` (set `LEGACY_AGENTARENA_SECRET`, the new `AGENTARENA_SECRET_KEY`, and `CONFIRM_AGENT_SECRET_MIGRATION=true`). The migration makes a timestamped backup and aborts on malformed records; never change the key without this step.

### Required production configuration

- `NODE_ENV=production`, `PORT`, `CORS_ORIGINS` (comma-separated exact origins)
- `AGENTARENA_SECRET_KEY` (64 hex characters)
- `DATABASE_URL` (required by startup guard; runtime repository migration remains outstanding)
- `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT`, and optional `REDIS_PASSWORD`
- `BIFROST_ENDPOINT` and `BIFROST_API_KEY` only when using Bifrost
- A separate hardened Docker worker with a dedicated daemon for code execution

The production `build` command creates the Vite frontend bundle and bundled Node backend; `start` runs the compiled backend. `npm test` runs the Stage 3–8 suites sequentially. Tests requiring live external infrastructure must be reported separately from fixture/unit tests.
