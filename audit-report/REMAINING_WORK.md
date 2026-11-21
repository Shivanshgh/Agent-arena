# Remaining Work (Prioritized)

## Phase 8 security follow-up

1. **Medium — distributed rate limits:** current global/auth maps remain process-local. Costly routes now also enforce a 10/min limit, keyed by account after authentication. Before multiple Render instances or sustained public use, add a shared Redis-backed limiter after testing it with a disposable Redis and deciding failure policy. The queue's production Redis was not used for tests. `REDIS_URL` could technically host separately prefixed atomic counter/TTL keys, but its Upstash behavior, capacity impact, and outage interaction with BullMQ have not been verified; a distinct logical database/instance is safer.
2. **Low — deployment check:** confirm `NODE_ENV=production` on Render. Production CSP is configured; HSTS is sent only for HTTPS requests. Verify forwarded protocol behavior on the deployed service.
3. **Low — endpoint hygiene:** avoid secret-bearing URL query parameters; dedicated encrypted agent auth fields are provided. AI semantic review is still probabilistic and must remain advisory.
4. Re-run a dependency advisory scanner when npm registry access is available. Current `npm audit` was blocked by DNS; no dependency vulnerability conclusion is available.
5. Follow up the user-run PostgreSQL failure: run a read-only query for the generated ownerless `Audit acc6b530 ...` agents before any further test. Do not delete these or any other database rows without the user's explicit approval.

Exact safe read-only query on the user's Windows PostgreSQL session (confirm connected to `agentarena_test` first):

```sql
SELECT "id", "name", "ownerId", "createdAt"
FROM "Agent"
WHERE "ownerId" IS NULL AND "name" LIKE 'Audit acc6b530 %'
ORDER BY "createdAt" DESC;
```

Do not share credentials or delete results automatically.

## P0 — Restore a real benchmark run on Render

1. Deploy the local queue fix to the main AgentArena Web Service. In Render, confirm `REDIS_URL` points to the intended Upstash instance, starts with `rediss://`, and its credential is current. Do not share the value.
2. If no separate worker service is running, set `AGENTARENA_WORKER_ENABLED=true` on that service; otherwise use the actual worker process. The flag does not fix a failed Redis connection.
3. Verify Redis `CONNECTED`, BullMQ queue ready, a real job processed, and execution data persisted. Check for redacted `[BullMQ] Redis connection error`, `[BullMQ] Queue connection error`, or enqueue failure logs if it remains blocked.
4. Never use the existing Redis instance for audit tests. Provide a separate test Redis endpoint as `AGENTARENA_TEST_REDIS_URL` before `npm run test:bullmq`.

### Render service settings

- Web Service build: `npm ci && npm run build`; start: `npm start`.
- Set `NODE_ENV=production`, `DATABASE_URL`, `AGENTARENA_SECRET_KEY` (same 64-hex value used to encrypt/decrypt agent credentials), `REDIS_URL` (Upstash TLS `rediss://` value), `CORS_ORIGINS`, and `AGENTARENA_WORKER_ENABLED=true` if this Web Service will run the worker.
- Alternative: create a Worker with build `npm ci && npm run build`, start `npm run worker`, and set the same `NODE_ENV`, `DATABASE_URL`, `AGENTARENA_SECRET_KEY`, and `REDIS_URL`. Do not rely on a worker flag to repair Redis connectivity.

## P1 — Make benchmark scores measure correctness

1. Define task test cases with inputs and expected outputs in a structured format.
2. Run returned code in a hardened isolated executor with resource and network limits.
3. Calculate accuracy from actual test outcomes; keep text heuristics as diagnostics only.
4. Verify retries, timeout persistence, worker restart, and idempotency using a dedicated Redis test instance.

## P1 — Verify optional AI integrations

1. Deploy `sample-agent` as its own Render Web Service and use Gemini keys as private environment variables; verify a provider-backed response before demoing it.
2. If AI semantic review is part of the demo, separately verify real Bifrost endpoint/provider configuration. `CONFIGURED` is not proof of connectivity.

## P2 — Frontend and release quality

1. Run browser workflows for registration, agent creation, tasks, benchmark launch, results, and error states.
2. Inspect mobile and laptop layouts visually; verify the new agent form on both.
3. Correct infrastructure dashboard semantics: distinguish a reachable queue from a running worker and display the active Redis target accurately without credentials.
4. Run `npm ci --include=dev` in a clean checkout and `npm run prisma:migrate:deploy` against a disposable database before submission.

## Audit test setup

- PostgreSQL: local dedicated `agentarena_test` only.
- Redis: create a separate disposable instance; set `AGENTARENA_TEST_REDIS_URL` in the local test process. Do not reuse the main `REDIS_URL`.
- Commands: `npm test`, `npm run test:postgres`, `npm run test:bullmq`, `npm run prisma:validate`, `npm run prisma:generate`, `npm run lint`, `npm run build`.

## Remaining work update (2026-11-20)

1. Start local PostgreSQL 17 and confirm the isolated `agentarena_test` database is reachable; rerun `npm run test:postgres` to exercise the prepared three-agent API workflow, evaluation persistence, leaderboard, ownership and restart checks.
2. Provision a disposable dedicated Redis, set `AGENTARENA_TEST_REDIS_URL` only in the local process, and run `npm run test:bullmq` for enqueue/process/retry/recovery. Never reuse hosted app Redis.
3. For Render verification, deploy the queue fix and run a real benchmark while checking redacted API/worker logs and PostgreSQL persistence. Render credentials/logs are not present here.
4. Replace correctness claims from text heuristics with actual test-case execution in a secure isolated sandbox before calling the scores reliable. No arbitrary code was run on this host.
5. Rerun `npm test` with local HTTP fixture access enabled; this environment denied loopback Stage 3 calls in the latest run.

## Dual-mode work remaining (2026-11-20)

1. Start isolated PostgreSQL and rerun `npm run test:postgres`; it now includes model credential ownership/encryption, model results, leaderboard, and restart persistence. Do not use production.
2. Configure disposable Redis only as `AGENTARENA_TEST_REDIS_URL`, then run `npm run test:bullmq` to verify enqueue, processing, retries, and recovery. Never reuse hosted app `REDIS_URL`.
3. For opt-in provider checks, configure credentials locally and test live calls; never paste secrets into chat or reports.
4. Review/apply the migration and verify web/worker queue behavior in Render; Render access was unavailable for this audit.
5. Add an isolated sandbox and task test harness before treating coding scores as proof of correctness.

## Exact blockers after verification continuation

- PostgreSQL service at `127.0.0.1:5432` is unreachable; Windows service inspection was denied. Start the local PostgreSQL service with administrator rights if required, then confirm the isolated `agentarena_test` database before applying migrations and rerunning integration.
- `AGENTARENA_TEST_REDIS_URL` is unset. Provide a disposable Redis endpoint (local loopback or dedicated TLS Redis) before queue lifecycle tests; never set it to the production app Redis.
- The isolated queue test harness covers retry, duplicate job ID, worker restart recovery, API restart, and PostgreSQL persistence. Run these after both local PostgreSQL and the disposable Redis are available.
- Live providers, Render behavior, and sandboxed code correctness remain NOT VERIFIED.

## Recheck 2026-11-21

The services are still unavailable from this workspace: local test PostgreSQL connect returns P1001 and no dedicated Redis URL is configured. Once available here, run `npm run prisma:migrate:deploy`, `npm run test:postgres`, and `npm run test:bullmq`; these are not complete yet. Do not substitute app `REDIS_URL`.

## Final pre-submission status — 2026-11-21

1. PostgreSQL integration: user reports `agentarena_test` is running and lists six audit agents plus two successful connection logs. Preserve them. The Codex environment cannot reach the user's Windows localhost; do not retry connectivity here. The previous guarded integration run stopped at the evaluation assertion; rerun the corrected runner locally only after reviewing its prompts and ensuring it will preserve these existing rows.
2. Redis/BullMQ: provide a dedicated disposable test Redis URL as `AGENTARENA_TEST_REDIS_URL`, not the production/app Redis, then run `npm run test:bullmq`.
3. Render: use the web/worker settings in README; verify with the owner's dashboard and one real benchmark after deployment. No live Render evidence exists in this workspace.
4. UI: no browser-test framework is configured; manually verify mobile/desktop drawer, keyboard focus/Escape, backdrop close, all nine sections, account menu, and both CTAs before publishing.
5. Scoring: correctness remains unverified unless tasks use exact checks or a future isolated sandbox. Heuristic and AI-assisted judgments are not proof of code correctness.

## Local Windows database verification handoff

Run `.\scripts\verify-postgres-windows.ps1` from `C:\agentarena`. If it reports only `20261120120000_model_benchmarking` pending and you approve the printed schema impact, rerun with `-ApplyPendingMigrations` and type its explicit confirmation. It never resets the database; tests separately prompt before creating and cleaning uniquely owned test records. Share migration status and final PASS/FAIL lines only, not `.env`.

Latest user run reports schema up to date. Before another integration run, inspect likely test-created ownerless agents read-only. Their removal needs separate approval; do not delete automatically. The evaluation assertion and owner-scoped cleanup have been fixed in code; database verification still requires a rerun after safe artifact review.
