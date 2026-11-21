# AgentArena — AI Coding Agent Benchmark & Evaluation Arena

AgentArena is a platform for registering, orchestrating, benchmarking, evaluating, and ranking autonomous AI coding agents over a standardized HTTP protocol. Its current deterministic evaluator scores returned source text; it does not run that code against executable test cases.

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
- **Stage 2**: Prisma/PostgreSQL runtime repositories are used by the application; JSON repositories are retained for automated tests and legacy import.
- **Stage 3**: Agent registration, AES-256-GCM authenticated encryption, SSRF protection against private ranges & cloud metadata, standardized HTTP communication protocol v1.0.
- **Stage 4**: Benchmark task definition, multi-agent battle orchestration, fault isolation.
- **Stage 5**: Deterministic heuristic evaluation of returned source text (not code execution) with weighted scoring:
  - Accuracy: **40%**
  - Task Completion: **25%**
  - Reliability: **15%**
  - Execution Speed: **10%**
  - Cost Efficiency: **10%** (Re-normalized dynamically when tokens unmeasured)
- **Stage 6**: Global leaderboard with tie-breaking, language/category filters, analytics aggregations, run history, and CSV/JSON report exports.
- **Stage 7**: BullMQ run dispatch is connected to the benchmark worker; Redis processing and Docker isolation still need live service validation. Bifrost requires credentials and contract testing.
- **Stage 8**: Security hardening and regression tests; production readiness remains conditional on database, queue, and sandbox integration.

> **Current readiness: partial.** PostgreSQL 17.12 was verified locally against `agentarena_test`: all three migrations applied, CRUD/auth/ownership and API-restart persistence passed, and valid legacy records were imported with source backups. Redis/BullMQ, Docker execution, and live Bifrost remain unverified.

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
- The API and worker use the same Prisma/PostgreSQL configuration; startup fails closed without `DATABASE_URL`. For local setup, create an empty PostgreSQL database, set `DATABASE_URL`, then run the two commands above before `npm run dev`.
- Keep existing `data/*.json` files backed up. Preview the legacy import with `node scripts/import-json-to-postgres.mjs`; it imports only records with valid relationships and reports every skipped record. `node scripts/import-json-to-postgres.mjs --apply` imports eligible records transactionally and preserves JSON backups under `data/pre-postgres-import-*`. Importing is repeatable by record ID; do not apply until the target database and backup plan are confirmed.
- Registration is open; new accounts receive the `USER` role and may access their own resources plus shared tasks. Promote an existing account deliberately with `node scripts/promote-admin.mjs user@example.com` after registration.

### 3. Queue Tier (Redis & BullMQ)
- Production must set `REDIS_URL` to a reachable Redis service; Upstash URLs should use `rediss://`. Configure the same `REDIS_URL` on the API and worker.
- The API enqueues jobs; run `npm run worker` as a separate process to consume them, or set `AGENTARENA_WORKER_ENABLED=true` on the API service to have it also process jobs. Do one or the other; the worker flag does not configure Redis.
- For a Render worker service, use the same repository/branch, build command `npm ci && npm run build`, and start command `npm run worker`. Set `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, and `AGENTARENA_SECRET_KEY` to the same values used by the Web Service.
- `npm run test:bullmq` requires the local `agentarena_test` PostgreSQL database plus `AGENTARENA_TEST_REDIS_URL` pointing at a separate test Redis instance. It refuses to reuse the main `REDIS_URL` host.
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
- Optional semantic review: deterministic evaluation is the default. AI review requires a separately running Bifrost gateway, gateway access settings (`BIFROST_ENDPOINT` ending in `/v1` and `BIFROST_API_KEY`), and an upstream provider/model configured in Bifrost. Set `BIFROST_EVALUATION_PROVIDER` and provider-qualified `BIFROST_EVALUATION_MODEL` in AgentArena, then request `aiAssisted: true` on the evaluation endpoint to add a validated semantic score and provenance. AI scores do not change deterministic scores; if gateway or provider setup is missing or fails, the request returns an error and saves no partial evaluation batch.
- Authorization secrets are kept server-side and redacted from all diagnostic endpoints.

### 6. Direct Model Benchmarking
- AgentArena can also compare Google Gemini, OpenAI, Anthropic Claude, and DeepSeek models. In **Model Connections**, validate a user-owned provider key, choose models returned by that provider's model-list endpoint, and save them. Keys are AES-256-GCM encrypted in PostgreSQL and are never returned to the browser.
- Model and HTTP-agent runs use the same `BenchmarkTask`, `BenchmarkRun`, and BullMQ queue, with distinct execution records and separate leaderboards. A run compares one execution type at a time; it does not mix model and agent rankings.
- Models receive a shared prompt built from the task instructions, language, and input. Provider-reported token usage and request latency are stored. Estimated cost remains unavailable because no maintained price catalog is configured.
- Task evaluation defaults to **Code response — correctness unverified**. Code is not executed by this implementation. Use **Exact text answer** or **Exact JSON value** for deterministic, verifiable response comparison. **Text heuristic** is explicitly labeled and is excluded from ranked leaderboards. Optional Bifrost semantic review is stored separately and never overwrites deterministic scores.
- Apply the additive model-benchmarking migration with `npm run prisma:migrate:deploy` before deploying the updated app. Keep the same production `AGENTARENA_SECRET_KEY` used to encrypt existing agent credentials; changing it makes stored keys unreadable.
- Provider references: [Gemini generateContent](https://ai.google.dev/api/generate-content), [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create), [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages), [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/).

---

## Environment Variables Reference

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | Optional | `3000` | Port for Express web and API server |
| `NODE_ENV` | Optional | `development` | Set to `production` in live deployments |
| `AGENTARENA_SECRET_KEY` | Required when encrypting credentials; mandatory in production | None | Exactly 32 random bytes encoded as 64 hexadecimal characters |
| `DATABASE_URL` | Required in production | None | PostgreSQL connection string; selects Prisma-backed repositories |
| `REDIS_HOST` | Optional | `127.0.0.1` | Redis host for BullMQ background queue |
| `REDIS_PORT` | Optional | `6379` | Redis port |
| `REDIS_PASSWORD` | Optional | Empty | Redis authentication password |
| `DOCKER_SOCKET` | Optional | `/var/run/docker.sock` | Dedicated worker Docker daemon socket |
| `BIFROST_ENDPOINT` | Optional | Empty | Bifrost gateway base URL ending in `/v1` |
| `BIFROST_API_KEY` | Optional | Empty | Bifrost bearer key |
| `BIFROST_EVALUATION_PROVIDER` | Optional | Empty | Provider for opt-in semantic review |
| `BIFROST_EVALUATION_MODEL` | Optional | Empty | Configured, provider-qualified model, e.g. `openai/gpt-4o-mini` |
| `ALLOW_LOCAL_TEST_AGENTS` | Optional | `false` in prod | Set to `true` only for dev localhost testing |

Provider keys are supplied by each authenticated user in Model Connections. They are not application environment variables. The local provider fixture override is test-only, accepts loopback HTTP only, and is disabled in production.

---

## Security Compliance

- **SSRF Defense**: Strict validation rejecting RFC 1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local (169.254.0.0/16), loopback, IPv6 equivalents, cloud metadata (`169.254.169.254`, `metadata.google.internal`), and DNS rebinding.
- **Credential Storage**: AES-256-GCM authenticated cipher with 96-bit random IV and integrity auth tags. Secrets are never exposed in responses or logs.
- **Rate Limiting**: Sliding window rate limiting on all API routes to mitigate DoS and brute-force attacks.
- **Secure Headers**: `nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`, and XSS filtering.
- **Sandbox Isolation**: Untrusted code is never executed directly on the application host server.


## Production Remediation Status (2026-11-14)

This source archive is **NOT PRODUCTION READY**. Authentication, session middleware, and server-side resource ownership checks are implemented. PostgreSQL 17.12 was verified on the local `agentarena_test` database; production deployment still requires provisioned Redis/BullMQ and Docker infrastructure, plus Bifrost credentials if that integration is used. JSON files remain preserved as legacy sources and for repeatable import.

The API requires an explicit `CORS_ORIGINS` allowlist and production startup checks PostgreSQL connectivity and the `AGENTARENA_SECRET_KEY`. Set the key to 32 random bytes encoded as 64 hex characters. Existing credentials created by the previous SHA-256-derived key format must be migrated first with `npm run crypto:migrate` (set `LEGACY_AGENTARENA_SECRET`, the new `AGENTARENA_SECRET_KEY`, and `CONFIRM_AGENT_SECRET_MIGRATION=true`). The migration makes a timestamped backup and aborts on malformed records; never change the key without this step.

### Required production configuration

- `NODE_ENV=production`, `PORT`, `CORS_ORIGINS` (comma-separated exact origins)
- `AGENTARENA_SECRET_KEY` (64 hex characters)
- `DATABASE_URL` (required by startup guard; Prisma migrations must be applied)
- `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT`, and optional `REDIS_PASSWORD`
- Run `npm run worker` as a separate background process, or set `AGENTARENA_WORKER_ENABLED=true` in the API service to let that process also consume BullMQ jobs.
- `BIFROST_ENDPOINT` and `BIFROST_API_KEY` only when using Bifrost
- Docker is not required for the current HTTP-agent path; the Docker executor is not wired into benchmark orchestration.

The production `build` command creates the Vite frontend bundle and bundled Node backend; `start` runs the compiled backend. `npm test` runs the Stage 3–10 suites sequentially. `npm run test:postgres` runs database-backed API integration checks and only accepts the local `agentarena_test` target. `npm run test:bullmq` requires `AGENTARENA_TEST_REDIS_URL` for an isolated Redis instance and refuses the main `REDIS_URL`. `/api/health` is a liveness check; `/api/ready` checks PostgreSQL; `/api/infrastructure/status` reports Redis, Docker, and Bifrost configuration.

## Known Limitations

- Authentication and owner scoping passed database-backed API tests with two users; production multi-instance rate limiting still requires shared Redis.
- Code task scores default to unverified; no submitted code is run. Explicit text heuristics remain diagnostic only and are excluded from leaderboards. Exact text and canonical JSON matching are currently supported; sandboxed code tests, mathematical checking, and general JSON-schema validation remain unimplemented.
- Provider usage is recorded, but estimated token cost is unavailable because pricing/version data is not maintained.
- The HTTP benchmark orchestrator does not use `DockerExecutor`; Docker status is an infrastructure probe, not evidence of sandboxed benchmark execution.
- PostgreSQL passed against local PostgreSQL 17.12. This audit has not yet verified BullMQ against an isolated Redis test instance; `npm run test:bullmq` requires `AGENTARENA_TEST_REDIS_URL`. Live Bifrost connectivity is unverified.
- Import applied to `agentarena_test`: 4 agents, 4 tasks, 1 run, 2 executions, 2 evaluations. It skipped 21 runs and 42 executions with missing parents/duplicate execution IDs; original JSON files and timestamped backups remain. Reapplying inserted zero duplicates.
- The restricted test environment denies loopback HTTP with `EACCES`; Stage 3–4 fixture suites pass when local networking is permitted.
- No hosted application, public repository, or walkthrough video has been published.
