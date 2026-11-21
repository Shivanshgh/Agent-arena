# Feature Matrix

Status meanings follow the audit request. “Tested” can mean an automated component test; the end-to-end column is stricter and requires exercising the application/API workflow.

| # | Feature | Status | Evidence and limitation | End-to-end verified |
|---:|---|---|---|---|
| 1 | Registration, login, logout, session persistence | Fully implemented and verified | PostgreSQL integration: user/session lifecycle and API restart | Yes |
| 2 | Password hashing and secure session cookie | Fully implemented and verified | Auth tests and PostgreSQL integration | Yes |
| 3 | Authentication and origin protection | Fully implemented and verified | Unauthorized and invalid-origin API checks | Yes |
| 4 | Cross-user ownership isolation | Fully implemented and verified | Two-user reads, writes, deletes, and private lists denied | Yes |
| 5 | Agent create/read/update/delete | Fully implemented and verified | PostgreSQL integration and API tests | Yes |
| 6 | Credential encryption and redaction | Fully implemented and verified | AES-GCM/redaction tests; secret values are not returned | Component tests |
| 7 | Endpoint URL and SSRF validation | Fully implemented and verified | Stage 3 range, metadata, and protocol tests | Component tests |
| 8 | Agent health checks, protocol, malformed responses, timeouts | Fully implemented and verified | Local mock HTTP fixture tests; successful fixture run in PostgreSQL integration | Yes, with fixture |
| 9 | Task CRUD and input validation | Fully implemented and verified | PostgreSQL integration and Stage 4 tests | Yes |
| 10 | Same-task, multiple-agent orchestration | Implemented but partially working | PostgreSQL test verifies direct `wait=true` execution with two fixtures; production async queue unavailable | Yes, direct test path only |
| 11 | Execution status, result persistence, API restart retrieval | Fully implemented and verified | PostgreSQL integration | Yes, after completed run |
| 12 | Redis connection and BullMQ dispatch | Implemented but partially working | Offline handling/idempotency unit tests pass; no isolated live Redis test; Render queue reported unavailable | No |
| 13 | BullMQ worker processing, retry, worker restart | Implemented but not verified | Retry/backoff configuration and helpers exist; no real queue job was processed in this audit | No |
| 14 | Weighted scores and missing-token handling | Fully implemented and verified as coded | Stage 5/8 tests cover weights, null cost metrics, failures | Partial; persisted evaluation tested |
| 15 | Verify generated code actually solves a task | Not implemented | No solution code execution/test harness in the current orchestrator; evaluator uses string heuristics | No |
| 16 | AI semantic review validation and persistence | Fully implemented and verified with a fixture | PostgreSQL integration and Bifrost fixture tests; deterministic scores remain separate | Yes, fixture only |
| 17 | Live Bifrost/provider connectivity | Implemented but not verified | No real gateway/provider credentials or live request used | No |
| 18 | Leaderboard ranks and filters | Fully implemented and verified | Stage 6 tests and PostgreSQL integration leaderboard check | Yes, fixture data |
| 19 | Analytics and CSV/JSON exports | Fully implemented and verified at service level | Stage 6 tests cover aggregation and report formats | Component tests |
| 20 | Prisma/PostgreSQL runtime and migrations | Fully implemented and verified locally | Existing migration history plus local PostgreSQL CRUD/integration checks | Yes, local DB |
| 21 | Docker sandbox for benchmark code execution | Not implemented in current workflow | `DockerExecutor` exists, but orchestrator only dispatches through `AgentHttpAdapter` | No |
| 22 | Frontend pages/forms/API feedback | Implemented but not verified in a browser | TypeScript and production build pass; no browser workflow run in this audit | No |
| 23 | Mobile/laptop responsive behavior | Implemented but not visually verified | Responsive source classes and build pass; no viewport/device run | No |
| 24 | Gemini sample agent | Implemented but partially working | Local health/auth/validation smoke passed; no live Gemini request or Render deployment | No, provider not tested |

## Counts used in readiness calculation

- **Implemented:** 22/24 (92%); includes partial and unverified code paths, and is not a readiness score.
- **Tested at some automated/component level:** 17/24 (71%); this does not mean all tested items passed a live or complete workflow.
- **End-to-end verified:** 12/24 (50%); uses local PostgreSQL and mock HTTP/Bifrost services. It excludes live Redis, live Bifrost, UI browser tests, and code correctness execution.

## Dual-mode benchmark additions (2026-11-20)

| Feature | Status | Evidence and limitation |
|---|---|---|
| Gemini, OpenAI, Anthropic, DeepSeek adapters/model listing | Implemented; contract-tested | Auth/request/response fixtures pass; live credentials not used |
| Encrypted owner-scoped credentials/model connections | Implemented; component-tested | AES authenticated encryption and ownership; migration not applied in this run |
| Model runs and separate leaderboard | Implemented; orchestration-tested | Real API + PostgreSQL + BullMQ path NOT VERIFIED |
| Evaluation strategies and provenance | Implemented; unit-tested | Code defaults unverified; exact text/JSON available; heuristic scores labeled/excluded from ranked scores; semantic review separate |

Earlier end-to-end counts describe the prior HTTP-agent inventory and do not include this work. Full API/database/queue integration is still unverified.

## Verification continuation

- Migration SQL static audit: PASS, additive/non-destructive; actual applied schema and historical row preservation: NOT VERIFIED.
- Model database workflow and existing HTTP-agent regression: BLOCKED by PostgreSQL being offline.
- BullMQ retry/restart/disconnection/recovery: BLOCKED by missing dedicated test Redis.
- All four provider mock adapters including unsupported models: PASS; live providers remain NOT VERIFIED.

Latest environment recheck (2026-11-21): PostgreSQL/model persistence and historical-data regression BLOCKED by unavailable `agentarena_test`; live BullMQ lifecycle BLOCKED by missing isolated Redis URL. Offline regression and provider mocks PASS.
