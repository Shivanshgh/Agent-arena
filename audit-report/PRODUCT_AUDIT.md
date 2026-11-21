# AgentArena Product Audit

## Executive finding

AgentArena substantially implements the *shape* of the chosen problem: developers can register HTTP coding agents, create tasks, run the same task across multiple agents, persist results, and compare them. Local PostgreSQL API integration and mock-agent execution pass. The deployed background queue is currently reported unavailable, live Redis/BullMQ was not safely verified, and the score called “accuracy” is based on text heuristics rather than running candidate code. Therefore, the central benchmark concept exists, but its results are not yet a reliable measure of coding correctness and the production benchmark path is not verified.

**Audit verdict:** prototype substantially implemented; not verified ready as a reliable live benchmarking platform.

## Original vision versus implementation

| Vision area | Verified implementation | Gap |
|---|---|---|
| Multiple independent coding agents | Agent HTTP protocol, registration, connection checks, and multi-agent orchestration exist. A local fixture run dispatched one task to two agents. | The real Render queue currently reports unavailable. The Gemini sample service was not deployed or provider-tested in this audit. |
| Same standardized benchmark tasks | Run creation and HTTP dispatch pass database-backed tests using a local mock agent. | Production dispatch through Redis/BullMQ was not tested. |
| Collect executions and metrics | Execution status, returned code, timing, optional token metrics, and persistence are implemented and tested against PostgreSQL. | No code execution occurs in the current orchestrator path. Missing token measures correctly remain null. |
| Evaluate performance and rank agents | Weighted deterministic scoring, semantic review via Bifrost, leaderboard, analytics, and exports exist; unit and database-backed tests pass. | Deterministic “accuracy” checks source length, language patterns, title keywords, and expected-output substrings. It does not prove that code solves a task. |
| Secure user and agent data | Password/session/origin/ownership tests, AES-GCM secret handling, and SSRF checks pass. | Production Render configuration and live multi-instance behavior were not inspected. |

## Execution flow traced

1. `POST /api/runs` validates a run and calls `BenchmarkOrchestrator.createAndLaunchRun` (`src/server/routes.ts:537`, `src/server/orchestrator.ts:20`).
2. In the normal asynchronous path, the orchestrator enqueues a BullMQ job (`src/server/orchestrator.ts:97`). `queueService.enqueueRunJob` refuses when Redis is disconnected or the Queue is absent (`src/server/infrastructure/queue.ts:142`). This matches the user-reported “Background queue unavailable” error: no benchmark job is started and the agent endpoint is not called.
3. With the test-only `?wait=true` path, the orchestrator directly calls `AgentHttpAdapter` (`src/server/orchestrator.ts:182–199`). The PostgreSQL integration test uses this path in development; it verifies a mock-agent run, not production BullMQ.
4. Results are stored in PostgreSQL and survive an API restart, as verified by `scripts/test-postgres-integration.mjs`.
5. `EvaluationEngine` derives scores from output text (`src/server/evaluation-engine.ts:73–157`); it does not run returned files. The Docker executor is checked by the infrastructure status route but is not called from the benchmark orchestrator (`src/server/routes.ts:745`, `src/server/orchestrator.ts`).

## Infrastructure interpretation

- **PostgreSQL:** PASS for local `agentarena_test`; migrations were present and database-backed CRUD, evaluation, authorization, and restart persistence passed.
- **Redis/BullMQ:** NOT VERIFIED against a dedicated test Redis. The local `.env` has a hosted Redis URL, but it was not used because it may be shared with the live app. User-reported Render status/error indicates Redis is not connected there; exact Render environment values were not inspected.
- **Worker:** Worker creation is conditional on `AGENTARENA_WORKER_ENABLED=true` (`src/server/infrastructure/queue.ts:103`). This flag does not make an unavailable Redis connection work.
- **Docker:** Docker executor code exists, but current HTTP benchmark orchestration does not invoke it. It is not required for the HTTP-agent transport, but returned code is not executed or validated.
- **Bifrost:** Fixture-based semantic review and persistence pass. `CONFIGURED` means a valid endpoint and non-empty key are present (`src/server/infrastructure/bifrost.ts:38–48`); it does not establish live connectivity. Live provider evaluation was not performed.

## Safe changes made

- Isolated the PostgreSQL integration test's child process from the developer's configured Redis, to prevent it from touching a shared queue.
- Made BullMQ integration require a separate `AGENTARENA_TEST_REDIS_URL` and reject the main Redis host; added `npm run test:bullmq`.
- Documented the worker option and clarified that scoring is heuristic and Docker is not wired into the HTTP benchmark path.

Detailed status and evidence are in [FEATURE_MATRIX.md](FEATURE_MATRIX.md), [TEST_RESULTS.md](TEST_RESULTS.md), [BUG_REPORT.md](BUG_REPORT.md), and [PRODUCT_READINESS.md](PRODUCT_READINESS.md).

## Dual-mode implementation update (2026-11-20)

The application now includes optional model benchmarking for Gemini, OpenAI, Anthropic, and DeepSeek alongside HTTP agents. Both use benchmark tasks and the BullMQ run queue. Provider credentials are encrypted and owner-scoped; model output and evaluation provenance are persisted separately. Code tasks default to `CODE_UNVERIFIED`; exact text and canonical JSON comparisons are opt-in. Heuristic scores are labeled and excluded from scored leaderboards. Optional Bifrost semantic review is stored separately.

Automated suites pass with local HTTP fixture access (Stages 3–8: 66 checks; auth/ownership, Bifrost, provider contract/error handling, and model orchestration also pass). Prisma validation/generation, TypeScript, and build pass. PostgreSQL integration is BLOCKED because local PostgreSQL is unreachable. Dedicated Redis/BullMQ, live provider calls, and Render deployment are NOT VERIFIED. No candidate code is executed or proven correct.

Verification continuation: static migration review found no destructive SQL and leaves HTTP-agent schema/data paths unchanged; database-level preservation remains NOT VERIFIED because local `agentarena_test` is offline. PostgreSQL migration/CRUD/E2E checks and real BullMQ lifecycle checks are BLOCKED by unavailable PostgreSQL and missing dedicated test Redis. The full offline suite and all four provider mock suites pass, including unsupported-model, rate-limit, auth, timeout, and malformed-response behavior.

Environment recheck (2026-11-21): PostgreSQL preflight and integration still fail before application tests; test Redis is not configured and the safety guard stopped queue tests. Offline full regression, Prisma validate/generate, lint, and build pass. No live database, Redis, provider, or Render result is claimed.
