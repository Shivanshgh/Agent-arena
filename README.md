# AgentArena — AI Coding Agent Benchmark & Evaluation Arena

AgentArena registers HTTP coding agents, runs shared benchmark tasks, stores executions, and compares results. It also supports optional direct model connections. **It does not execute submitted code against hidden tests**; code answers are marked unverified unless a task uses exact text/JSON comparison. Heuristic and optional AI-assisted reviews are not proof of correctness.
LIVE LINK :- https://agent-arena-igk5.onrender.com

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
│ • AES-256-GCM Crypto │ │ • Multi-Agent Battle │ │ • Optional Docker Box │
│ • SSRF/DNS Pinning   │ │ • Stage 5 Evaluation │ │ • Redis Queue         │
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
- **Stage 5**: Deterministic evaluation of returned responses (not code execution) with weighted scoring:
  - Accuracy: **40%**
  - Task Completion: **25%**
  - Reliability: **15%**
  - Execution Speed: **10%**
  - Cost Efficiency: **10%** (Re-normalized dynamically when tokens unmeasured)
- **Stage 6**: Global leaderboard with tie-breaking, language/category filters, analytics aggregations, run history, and CSV/JSON report exports.
- **Stage 7**: BullMQ dispatch and worker are implemented. Unit/configuration tests pass; real Redis queue processing and recovery still need isolated live verification. Docker exists but is not wired to the HTTP-agent benchmark workflow.
- **Stage 8**: Security hardening and regression tests cover SSRF/DNS pinning, bounded responses, authentication, ownership, headers, and AI review separation.
- **Stages 9–10**: Authentication/ownership and model-provider/Bifrost adapters have offline tests; live PostgreSQL, providers, Bifrost, and Render results are tracked below.

> **Current readiness: local checks pass; live readiness is incomplete.** The user reports PostgreSQL 17.12 connectivity and an up-to-date schema on `agentarena_test`, but their latest integration run stopped at a test assertion; the test fix has not been rerun. Preserve existing test records. Dedicated Redis/BullMQ and Render behavior are unverified. No live provider calls were made.

---

## Quickstart

### Prerequisites
- Node.js 20.19+ (or a compatible newer LTS release)
- npm
- PostgreSQL. Redis is required for background benchmark processing.

### Local Development
```bash
# 1. Install locked dependencies
npm ci

# 2. Configure environment in an ignored .env file
cp .env.example .env
# Edit .env locally: set DATABASE_URL for your PostgreSQL database,
# AGENTARENA_SECRET_KEY, exact CORS_ORIGINS, and REDIS_URL for queue use.

# 3. Generate the client, apply migrations, then start (default port 3000)
npm run prisma:generate
npm run prisma:migrate:deploy
npm run dev
```

For asynchronous benchmark processing, run `npm run build` and `npm run worker` in a separate terminal, or use `AGENTARENA_WORKER_ENABLED=true` for a single local API/worker process. Both require the same database and Redis configuration.

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
# Run the full offline regression suite (Stages 3–10)
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
- Build command: `npm ci && npm run build`. Start command: `npm start` (`node build/server.js`).
- The Express server serves both `/api/*` endpoints and static frontend assets from `dist/`.
- Rate limits are process-local (10 requests/minute on protected routes); they are not shared across service replicas.
- Graceful shutdown handles `SIGTERM` and `SIGINT` by stopping incoming requests, draining connections, and closing Redis/BullMQ workers.

#### Render service settings
- Create one **Web Service** from this repository/branch, runtime **Node**, build `npm ci && npm run build`, start `npm start`.
- Render supplies `PORT`; add `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `AGENTARENA_SECRET_KEY` (64 hex chars), and `CORS_ORIGINS` (comma-separated exact public origins, including the `https://` scheme).
- Apply migrations manually against the intended database with `npm run prisma:migrate:deploy` before releasing the new web build. Do not run migrations from app startup.
- Use a separate **Background Worker** with the same repository/branch and build command, start `npm run worker`, and the same `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, and `AGENTARENA_SECRET_KEY` values. Leave `AGENTARENA_WORKER_ENABLED` unset/false on the web service when using this worker.
- The web service serves the frontend; no separate Static Site is needed. A Render blueprint is not present in this repository.

### 2. Database Tier (PostgreSQL)
- Set `DATABASE_URL="postgresql://user:password@host:5432/agentarena"` in production.
- Apply Prisma migrations:
  ```bash
  npm run prisma:migrate:deploy
  npm run prisma:generate
  ```
- The API and worker use the same Prisma/PostgreSQL configuration; startup fails closed without `DATABASE_URL`. For local setup, create an empty PostgreSQL database, set `DATABASE_URL`, then run the two commands above before `npm run dev`.
- Keep existing `data/*.json` files backed up. Preview the legacy import with `node scripts/import-json-to-postgres.mjs`; it imports only records with valid relationships and reports every skipped record. `node scripts/import-json-to-postgres.mjs --apply` imports eligible records transactionally and preserves JSON backups under `data/pre-postgres-import-*`. Importing is repeatable by record ID; do not apply until the target database and backup plan are confirmed.
- Registration is open; new accounts receive the `USER` role and may access their own resources plus shared tasks. Promote an existing account deliberately with `node scripts/promote-admin.mjs user@example.com` after registration.

### 3. Queue Tier (Redis & BullMQ)
- Production must set `REDIS_URL` to a reachable Redis service; Upstash URLs should use `rediss://`. Configure the same `REDIS_URL` on the API and worker.
- The API enqueues jobs; run `npm run worker` as a separate process to consume them, or set `AGENTARENA_WORKER_ENABLED=true` on the API service to have it also process jobs. Do one or the other; the worker flag does not configure Redis.
- For a Render worker service, use the same repository/branch, build command `npm ci && npm run build`, and start command `npm run worker`. Set `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, and `AGENTARENA_SECRET_KEY` to the same values used by the Web Service.
- `npm run test:bullmq` requires the local `agentarena_test` PostgreSQL database plus `AGENTARENA_TEST_REDIS_URL` pointing at a separate test Redis instance. It refuses to reuse the main `REDIS_URL` host.
- BullMQ uses `runId` as the job ID to prevent duplicate enqueueing while that job is retained by the queue.

### 4. Optional Sandbox Execution (Docker)
- The Docker executor is not currently called by HTTP-agent benchmark orchestration, so Docker is not required for those runs. If you enable the executor in a future workflow, use a dedicated Docker-capable worker; never expose its socket to the public web/API service. Live daemon isolation is NOT VERIFIED.
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
| `CORS_ORIGINS` | Required in production | None | Comma-separated exact allowed browser origins |
| `REDIS_URL` | Required for queue in production | None | Redis URL; use `rediss://` for TLS endpoints such as Upstash |
| `REDIS_HOST` | Optional | `127.0.0.1` | Redis host for BullMQ background queue |
| `REDIS_PORT` | Optional | `6379` | Redis port |
| `REDIS_PASSWORD` | Optional | Empty | Redis authentication password |
| `AGENTARENA_WORKER_ENABLED` | Optional | `false` | Enable the BullMQ worker inside the web process instead of a separate worker service |
| `DOCKER_SOCKET` | Optional | `/var/run/docker.sock` | Dedicated worker Docker daemon socket |
| `AGENTARENA_DOCKER_IMAGE_PYTHON`, `AGENTARENA_DOCKER_IMAGE_NODE` | Optional | Empty | Immutable image digests for the optional Docker executor; not used by current HTTP-agent runs |
| `BIFROST_ENDPOINT` | Optional | Empty | Bifrost gateway base URL ending in `/v1` |
| `BIFROST_API_KEY` | Optional | Empty | Bifrost bearer key |
| `BIFROST_EVALUATION_PROVIDER` | Optional | Empty | Provider for opt-in semantic review |
| `BIFROST_EVALUATION_MODEL` | Optional | Empty | Configured, provider-qualified model, e.g. `openai/gpt-4o-mini` |
| `ALLOW_LOCAL_TEST_AGENTS` | Optional | `false` in prod | Set to `true` only for dev localhost testing |
| `AGENTARENA_TEST_REDIS_URL` | Tests only | None | Dedicated disposable Redis for `npm run test:bullmq`; never use production Redis |

Provider keys are supplied by each authenticated user in Model Connections. They are not application environment variables. The local provider fixture override is test-only, accepts loopback HTTP only, and is disabled in production.

---

## Security Overview

- Agent URLs reject loopback, private, reserved, and metadata destinations. DNS results are validated and pinned to the request connection; connected peer addresses are checked and redirects are rejected. TLS verification uses the original hostname.
- Agent/provider credentials are encrypted at rest with AES-256-GCM. Session tokens are stored hashed; authentication uses secure cookie settings in production. Resource APIs enforce user ownership.
- Mutating browser requests use origin checks, production CORS uses exact allowlisted origins, and request/agent/provider response bodies are bounded. Costly routes have process-local 10/minute limits; these are not shared across web replicas.
- Production CSP is configured; HSTS is sent only for HTTPS requests. Deployed browser/proxy behavior still needs verification.
- Docker execution is optional and not wired to the HTTP-agent benchmark workflow. That workflow does not run submitted code on the host.


## Current Verification Status (2026-11-21)

The local offline suite, lint/type check, Prisma validation, and production build pass. Database integration was attempted by the user on Windows and reached PostgreSQL, but the run stopped at a test assertion; the test assertion and cleanup logic were corrected afterward and have not yet been rerun. Do not treat PostgreSQL CRUD/persistence integration as fully verified. BullMQ lifecycle testing requires a dedicated disposable Redis and remains unverified. Render runtime behavior, live provider access, and production logs have not been checked. JSON backups remain preserved.

The API requires an explicit `CORS_ORIGINS` allowlist and production startup checks PostgreSQL connectivity and `AGENTARENA_SECRET_KEY`. The key must be 32 random bytes encoded as 64 hex characters. If upgrading data encrypted with the previous key format, review the migration instructions and back up the database before using `npm run crypto:migrate`; it requires `LEGACY_AGENTARENA_SECRET`, the new `AGENTARENA_SECRET_KEY`, and `CONFIRM_AGENT_SECRET_MIGRATION=true`. Never rotate the key without migrating existing encrypted credentials.

### Required production configuration

- `NODE_ENV=production`, `PORT`, `CORS_ORIGINS` (comma-separated exact origins)
- `AGENTARENA_SECRET_KEY` (64 hex characters)
- `DATABASE_URL` (required by startup guard; Prisma migrations must be applied)
- `REDIS_URL` (TLS `rediss://` where required; same target on API and worker)
- Run `npm run worker` as a separate background process, or set `AGENTARENA_WORKER_ENABLED=true` in the API service to let that process also consume BullMQ jobs.
- `BIFROST_ENDPOINT` and `BIFROST_API_KEY` only when using Bifrost
- Docker is not required for the current HTTP-agent path; the Docker executor is not wired into benchmark orchestration.

The build creates the Vite frontend bundle and bundled Node backend; `start` runs the backend on Render's `PORT` at `0.0.0.0`. `npm test` runs offline/mock stages sequentially and is not a live-service test. `npm run test:postgres` accepts only the dedicated local `agentarena_test` target. `npm run test:bullmq` requires a separate `AGENTARENA_TEST_REDIS_URL` and refuses to reuse the app Redis host. `/api/health` is a liveness check; `/api/ready` checks PostgreSQL; `/api/infrastructure/status` reports Redis, Docker, and Bifrost configuration.

## Known Limitations

- Authentication and owner scoping have offline/API test coverage; the latest full PostgreSQL integration run did not complete. Production multi-instance rate limiting still requires shared Redis.
- Code task scores default to unverified; no submitted code is run. Explicit text heuristics remain diagnostic only and are excluded from leaderboards. Exact text and canonical JSON matching are currently supported; sandboxed code tests, mathematical checking, and general JSON-schema validation remain unimplemented.
- Provider usage is recorded, but estimated token cost is unavailable because pricing/version data is not maintained.
- The HTTP benchmark orchestrator does not use `DockerExecutor`; Docker status is an infrastructure probe, not evidence of sandboxed benchmark execution.
- User reports PostgreSQL 17.12 connectivity and four migrations up to date, with six audit agents and two successful connection logs in `agentarena_test`. These records were not inspected by this environment and must be preserved. The latest integration run stopped at an evaluation assertion; a test-side fix is not yet rerun.
- A prior importer report records 4 agents, 4 tasks, 1 run, 2 executions, and 2 evaluations imported; 21 runs and 42 executions were skipped for invalid/missing relationships or duplicate IDs. This is historical report data, not a fresh database count. Keep JSON sources/backups preserved.
- Full offline tests pass when loopback fixture access is permitted. PostgreSQL integration, disposable Redis/BullMQ, live Bifrost/provider calls, and Render behavior remain unverified. Dependency advisory scanning was not verified because registry access previously failed.
- Render deployment state is not verified from this environment.
