# Bug Report

| ID | Severity | Finding/root cause | Fix/status |
|---|---|---|---|
| B-01 | Critical | The reported run error occurs before the agent is called. The API previously initiated Redis asynchronously, then immediately checked `redisConnected` and `benchmarkQueue`; the first/cold request could fail before connection/readiness. It also did not initialize the queue from Redis's later `ready` event after recovery. Separately, missing production `REDIS_URL` silently selected localhost. These are confirmed code defects that can produce the observed error. Whether any one was the exact cause of the live Render incident remains unconfirmed because its environment/logs are inaccessible here. | Fixed locally: enqueue waits up to 10s for Redis, Queue, and any co-located Worker readiness; the `ready` event initializes the queue after recovery; production refuses silent localhost fallback; queue/worker errors are credential-redacted. Live Render must still be redeployed/tested. |
| B-02 | Critical | “Accuracy” is not functional correctness. The evaluator scores nonempty text, language regexes, title keywords, and expected-output substrings (`src/server/evaluation-engine.ts:73–157`); returned code is never run. | Not changed: real code execution needs a deliberate secure execution/test harness. Scores must be described as heuristic until then. |
| B-03 | High | Docker executor is not connected to benchmark orchestration; `BenchmarkOrchestrator` uses `AgentHttpAdapter`, while Docker is only probed by infrastructure status. | Not changed: avoid a risky architecture expansion during audit. README now states this limit. |
| B-04 | High | BullMQ status is `ACTIVE` when Redis and Queue are ready; it does not prove a separate Worker is consuming jobs (`src/server/infrastructure/queue.ts`, status method). | Still open. The worker now emits a readiness log; the UI/status API does not yet report remote worker presence. |
| B-05 | Medium | Bifrost status `CONFIGURED` only checks endpoint syntax and nonempty key (`src/server/infrastructure/bifrost.ts:38–48`); it is not a connectivity result. | No live call made; reports and UI should call this “configured,” not “connected.” |
| B-06 | High | The original BullMQ integration test inherited `.env` `REDIS_URL` and used the shared queue name, risking production queue data. The PostgreSQL test process also inherited that Redis URL. | Fixed safely: PostgreSQL test subprocess is redirected to local closed port 1; BullMQ test now requires a distinct `AGENTARENA_TEST_REDIS_URL` and rejects the main Redis host. Added `npm run test:bullmq`. |
| B-07 | Medium | The Redis status payload reports fallback `REDIS_HOST`/`REDIS_PORT` even when a remote `REDIS_URL` is used, which can mislead diagnosis. | Not fixed in this audit; no runtime behavior impact, but status reporting should derive host/port from the active URL without exposing credentials. |

No claim is made that live Render Redis configuration or queue processing is repaired. The safe local queue integration is blocked pending a separate test Redis endpoint.

## Phase 8 security audit — 2026-11-21

| ID | Severity | Finding / exploitability | Fix / recommendation |
|---|---|---|---|
| S-01 | Fixed | DNS rebinding/TOCTOU: separate DNS validation followed by `fetch` could resolve to another IP. | Fixed locally: `src/server/pinned-http.ts` connects directly to the IP checked by SSRF validation, checks the connected socket IP, and retains the original hostname for HTTPS SNI/certificate verification. Redirects remain rejected. DNS rebinding regression passes. |
| S-02 | Medium | Global and login/register limits still use in-memory maps; they reset on restart and do not coordinate across replicas. Behind a proxy, the global IP bucket may be shared. Costly agent tests/execution, benchmark runs/evaluations, registration/login, and provider connection tests now also have the existing 10/minute limiter; authenticated actions key on account ID. | Redis can support shared limits with atomic counters/TTL and a dedicated key prefix, but coupling to the BullMQ Redis could make both functions share failure/capacity. Distributed storage is not implemented or live-tested; use an isolated test Redis and preferably a separate logical instance/namespace before deployment. |
| S-03 | Low | `NODE_ENV` controls production HTTPS and local-address policy. If a deployment omits `NODE_ENV=production`, the development path permits local HTTP endpoints. This is a deployment misconfiguration risk, not verified on Render. | Ensure production deployment explicitly sets `NODE_ENV=production`; verify environment at startup/deployment. |
| S-04 | Low | AI semantic review remains susceptible to model-level prompt injection in principle. | Reduced: fixed evaluator policy is sent as a separate system message; task and candidate response are JSON user data, output remains schema-bounded and separate from deterministic scores. This is not a formal guarantee against model manipulation; keep it advisory. |
| S-05 | Informational | Custom evaluation weights are accepted (`src/types/evaluation.ts:74-86`) and can change an owner's stored score on recalculation. Current user leaderboard data is owner-scoped; this is not cross-user score tampering, but owner-controlled scores are not comparable across benchmark settings. | Preserve weight/version provenance and use server-fixed weights for any public competition leaderboard. |
| S-06 | Fixed | Production previously omitted explicit CSP and HSTS. | Added production CSP; HSTS is sent only when the request is HTTPS (`req.secure` or forwarded protocol is HTTPS), without `includeSubDomains`/preload. Development headers remain unchanged. Header policy tests pass. |
| S-07 | Low | Agent endpoint query strings are stored as part of the endpoint. Embedded username/password URL credentials are now rejected, but query parameters may still contain user-provided secrets and are returned to that same owner. | Put credentials in the dedicated encrypted auth fields; avoid secret-bearing endpoint query parameters. |
| S-08 | Fixed | Provider and Bifrost responses were read without an effective streaming cap. | Both now use bounded streaming reads (2 MiB); oversized replies are cancelled and produce generic errors without provider body or credential disclosure. Regression tests pass. |

### Fixed during this audit

- Production now ignores `allowLocal` options and `ALLOW_LOCAL_TEST_AGENTS`; private/loopback targets remain blocked.
- HTTP agents connect directly to the validated IP, verify the socket's peer address, retain HTTPS SNI/hostname verification, and reject redirects.
- Added blocks for shared carrier-grade, documentation-only, and benchmarking IPv4 ranges; reject URL-embedded username/password.
- Health and execution response bodies are now streamed with byte caps (64 KiB health, configured execution cap); request timeouts remain active while reading the response body.
- Provider and Bifrost reply bodies are streamed with a 2 MiB cap; oversized content is cancelled and not returned.
- Added a separate evaluator system policy, JSON-encoded untrusted task/response data, per-account local limits for costly routes, production CSP and HTTPS-only HSTS.
- Regression coverage added for DNS pinning, IP ranges, embedded credentials, bounded agent/provider/Bifrost responses, evaluator prompt separation, rate limits, and headers.

### Reviewed with no issue found

- Session tokens are random, only SHA-256 hashes are stored, cookies are HttpOnly/SameSite Strict and Secure in production; passwords use scrypt.
- Agent/provider API credentials are AES-256-GCM encrypted at rest; public agent/model views omit secrets. Provider calls use fixed official hosts and normalize errors without including keys.
- Route data access is owner-scoped for agents, runs, model connections, evaluations and model leaderboards; foreign objects resolve as not found. Prisma is parameterized; no unsafe SQL was found in application routes.
- Mutating API calls require an allowlisted Origin/Referer; CORS uses exact origins. JSON bodies are limited to 2 MiB. No unsafe `innerHTML`/`dangerouslySetInnerHTML` use or submitted-code execution on the host was found.
- Docker executor uses fixed commands, digest-pinned configured images and restrictive container flags; Docker is not on the HTTP-agent path. No user-controlled file path handling was found.

## E2E verification update (2026-11-20)

- **B-08 | Critical |** Scoring heuristic can reward source text containing the sample expected output and penalize a general solution that computes it without embedding the literal. Partial/constant answers can tie or outrank correct general solutions. Confirmed by inspection of evaluator rules and the planned fixture assertions; full DB-backed comparison blocked because local PostgreSQL was offline. Do not describe accuracy as functional correctness.
- Queue behavior is still not established against any Redis in this run. Dedicated test Redis missing; shared hosted Redis intentionally untouched. Render root cause remains unverified.
- Local integration test did not reach app API because its guarded local PostgreSQL target was unavailable. No application defect is inferred from that connectivity failure.

## Dual-mode benchmarking update (2026-11-20)

- Code correctness defaults to `UNVERIFIED`; exact text/JSON checks are explicit, and heuristic scores are labeled and excluded from scored rankings. No sandboxed code execution was added.
- Provider adapters pass fixture tests for supported providers, malformed responses, timeouts, bounded rate-limit retry, and secret-safe errors. No live provider was contacted.
- The additive schema migration passes Prisma validation/generation, but deployment and data-level ownership/persistence are NOT VERIFIED because PostgreSQL at `127.0.0.1:5432` is unavailable.
- Real BullMQ processing/recovery is NOT VERIFIED. No dedicated test Redis is configured; hosted Redis was not used.

## Verification continuation

- Migration audit: **PASS, static**; additive SQL only. Existing HTTP-agent data is not targeted, but actual historical-row preservation is **NOT VERIFIED** because PostgreSQL is unavailable.
- Migration execution, model CRUD/key encryption in PostgreSQL, ownership, model run/evaluation/leaderboard persistence, and HTTP history regression: **BLOCKED** by unavailable local `agentarena_test` service.
- Real queue retry/restart/disconnect/duplicate recovery: **BLOCKED** by absent isolated test Redis. The guard prevented access to hosted `REDIS_URL`.
- Provider adapter unsupported-model 404 coverage added; provider fixture test suite passes. No live provider calls were made.

## Environment recheck (2026-11-21)

The blockers persist: `agentarena_test` is configured but PostgreSQL is unreachable (P1001); test Redis URL is absent and the BullMQ safety guard refuses app Redis. No new runtime defect was established; database and live queue behavior remain unverified. Full offline regression and provider fixtures pass.

## PostgreSQL integration test defects found (2026-11-21)

- Test contract bug: `/runs/:id/evaluate` returns model executions with nested `.evaluation`; test incorrectly read `accuracyScore` and `evaluationStatus` from the top level. Corrected the assertions.
- Cleanup bug: temporary agent names did not start with the cleanup marker; owner deletion sets `ownerId` NULL, leaving likely three fixture agents. Corrected cleanup to delete rows by the two unique generated test-user IDs. These fixes have syntax checks only; no DB rerun yet.

## Final pre-submission update (2026-11-21)

- Header navigation was moved into a responsive, keyboard-accessible drawer without removing any of the nine existing sections or the Launch Battle/New Task actions. No new UI regression was found by typecheck/build; browser interaction is not automated in this repository.
- Full local tests pass when local HTTP fixtures can bind/connect. In this restricted environment the initial run's Stage 3–4 failures were `EACCES` loopback restrictions, not an app regression; rerun with loopback access passed.
- No live PostgreSQL, Redis/BullMQ, provider, or Render issue was tested in this pass. User-reported database fixtures remain untouched.
