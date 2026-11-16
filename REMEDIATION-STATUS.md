# AgentArena remediation audit

Audit date: 2026-11-13. Source of truth: supplied `Final(1).zip`.

## Verdict

**NOT PRODUCTION READY.** This patch improves several safety and startup behaviors, but the primary database migration requirement is not complete. The current repositories still persist agents, tasks, runs, and evaluations in `data/*.json`. PostgreSQL/Prisma has not been connected to those repositories, no migration history or verified JSON import exists, and existing JSON data must be retained.

| Area | Status | Evidence / limitation |
|---|---|---|
| PostgreSQL / Prisma | FAIL | Schema constraints updated and Prisma packages/scripts declared, but no Prisma repository implementation, migration, or live DB validation. JSON remains source of truth. |
| BullMQ | NOT TESTED | Worker now calls `BenchmarkOrchestrator.resumeRun` and run enqueue is wired, but Redis was not available for live processing. Repository state is still JSON, not PostgreSQL. |
| Docker isolation | NOT TESTED | Executor now rejects missing digest-pinned images and unsupported languages, bounds output, applies no-network/non-root/cap-drop/resource controls, and attempts forced cleanup. No Docker daemon was available for execution tests. |
| Redis | BLOCKED BY EXTERNAL INFRASTRUCTURE | No Redis service/CLI available in the audit environment. |
| Bifrost | NOT TESTED | Endpoint validation and bounded upstream error reporting added. No gateway credentials/service available. |
| Security | PARTIAL / NOT READY | Production encryption key has no fallback and is validated; exact CORS allowlist required; proxy headers are not trusted for client IP; malformed JSON data is no longer overwritten by seed fallback; production mock seeds disabled. DB and distributed rate limiting remain unresolved. |
| Production build | NOT TESTED | Frontend/backend build scripts and Node production start command added. Dependency installation timed out, so build could not be executed. |
| Tests | NOT TESTED | Default test script now targets Stages 3–8 and supplies an ephemeral test-only encryption key. Dependencies could not be installed; no test results are claimed. |

## Changes made

- `src/server/crypto.ts`: removed default key fallback; requires exactly 32 bytes represented by 64 hex characters. Added an opt-in backup-first credential re-encryption utility for legacy JSON agent records.
- `server.ts`: dotenv loads before app imports; production requires `DATABASE_URL`, a valid encryption key, and explicit `CORS_ORIGINS`; CORS no longer reflects arbitrary origins; forwarded IP headers are not trusted; in-memory bucket count is bounded; liveness endpoint added.
- `src/server/infrastructure/docker-executor.ts`: unsupported/unconfigured runtimes fail closed; image refs must be SHA-256 digest-pinned; daemon check uses `docker info`; no-new-privileges, bounded byte streams, timeout and forced cleanup added.
- `src/server/orchestrator.ts`, `src/server/infrastructure/queue.ts`: run enqueue now attempts BullMQ; worker dispatches to existing benchmark orchestrator and skips non-queued executions. This remains JSON-backed and needs live Redis testing.
- `src/server/infrastructure/bifrost.ts`: validates HTTP(S) endpoint shape and avoids returning raw upstream error bodies.
- `src/server/db.ts`, `src/server/benchmark-db.ts`, `src/server/evaluation-db.ts`: malformed existing JSON now fails rather than silently replacing data; demo seeds require explicit opt-in and are disabled in production.
- `prisma/schema.prisma`: uniqueness constraints added for run/agent, request ID, and evaluation/execution.
- `package.json`, `scripts/test.mjs`, `.env.example`, `README.md`: build/test/deployment commands and environment guidance updated.

## Required before production

1. Implement async Prisma repositories for all four persisted domains and verify all existing JSON rows are imported transactionally; retain source JSON until row counts and checksums reconcile.
2. Provision PostgreSQL and Redis, run schema validation/migrations, and exercise create/update/delete + queue worker flows against real services.
3. Run the dedicated Docker worker with digest-pinned images and perform adversarial timeout/output/network/filesystem tests. Do not expose the Docker socket to the public API or untrusted containers.
4. Configure Bifrost credentials and verify the installed gateway API contract with a live request.
5. Install dependencies, run `npm run lint`, `npm run build`, `npm test`, and `npm run prisma:validate`; record actual outputs.
6. Replace the in-memory rate limiter with shared Redis-backed limiting before multi-instance deployment.

No production deployment, live database connection, live queue, live Docker workload, or live Bifrost call was performed during this remediation.

## Follow-up verification (2026-11-14)

- Fixed the missing Prisma relation opposite field and generated a valid PostgreSQL baseline migration at `prisma/migrations/20261114000000_initial/migration.sql`.
- Added `scripts/import-json-to-postgres.mjs`. Its default mode is a read-only dry-run; `--apply` uses one transaction, skips duplicate IDs, and copies JSON files into a timestamped backup directory before import.
- Import dry-run inspected 76 records: 4 agents, 4 tasks, 22 runs, 44 executions, and 2 evaluations. It found 4 agents, 4 tasks, 1 fully valid run, 2 executions, and 2 evaluations. It skips 21 runs and 42 executions as whole-run groups: 16 runs have missing task parents; 5 more runs refer to missing agent `agent-fixture-b` and reuse execution IDs `exec-s6-1`/`exec-s6-2`. No parents or outputs are fabricated; original JSON files were not changed.
- Removed unused nested source ZIP snapshots from `public/assets/aistudio/`; no application references to that directory were found.
- Checks using the existing `node_modules`: TypeScript PASS; Prisma validate/generate PASS; Vite frontend and esbuild backend build PASS. Dependency installation was NOT VERIFIED (`npm` is unavailable; `pnpm` cannot create its required workspace symlink under this environment).
- Automated suites: A restricted run denied loopback `fetch` with `EACCES`; fixtures already bind to a dynamic port on `127.0.0.1`, wait for listen, and close cleanly. The full suite passed Stages 3–8 when rerun with loopback networking permitted. PostgreSQL, Redis, Docker execution, and Bifrost remain NOT VERIFIED.
- Added `src/server/runtime-db.ts` and routed the API, orchestration worker, analytics, and connection logs through Prisma when `DATABASE_URL` is configured. Production API and worker fail closed without a database URL; startup now connects to PostgreSQL. Tests and local development without a configured database retain the JSON adapter.
- Live PostgreSQL remains NOT VERIFIED. Reconcile the 21 skipped runs and 42 executions before importing. Authentication/authorization was added in the final phase below; public deployment remains blocked pending live infrastructure and end-to-end verification.

## Final remediation phase (2026-11-14)

- Added account registration/login/logout, scrypt password hashing, hashed opaque sessions, secure HttpOnly/SameSite cookies, auth rate limiting and mutation-origin validation. Added server-side owner scoping for agents, runs, private tasks, executions, evaluations, and analytics; shared/imported tasks remain readable.
- Added sign-in/register UI and account sign-out. Added Stage 9 authentication/ownership unit checks.
- Added migration `20261114120000_auth_and_ownership`; Prisma schema validation/client generation, TypeScript, and production build pass.
- Full suite with loopback networking permitted: Stages 3–9 pass, including Stage 3 16/16 and Stage 4 8/8. A restricted run failed only because its runtime blocked local fixture requests (`EACCES`).
- Importer dry-run: 76 inspected; agents 4/4 valid, tasks 4/4 valid, runs 1/22 valid, executions 2/44 valid, evaluations 2/2 valid; reconciled 0. Invalid run trees are skipped without altering source JSON.
- PostgreSQL URL, `psql`, and Docker were unavailable. No migration or import was applied; PostgreSQL persistence, cross-user database isolation, import counts, and restart persistence are NOT VERIFIED. Redis/BullMQ, Docker daemon execution, and Bifrost remain NOT VERIFIED. No public deployment, GitHub publication, or demo recording was made.

## PostgreSQL live verification update (2026-11-14; supersedes prior PostgreSQL status)

- Connected to PostgreSQL **17.12** at `127.0.0.1:5432`, database `agentarena_test`, schema `public`. `.env` is Git-ignored; its password is not recorded here.
- Applied all three migrations, including evaluation run/task foreign keys after confirming existing imported evaluation references were valid. `prisma migrate status` reports the schema is up to date.
- Added `scripts/test-postgres-integration.mjs` and `npm run test:postgres`. All 7 integration groups passed: readiness/migration, auth/password/session/logout, agent/task CRUD and connection test, run/execution/evaluation/leaderboard, cross-user access controls, and session/run/evaluation persistence after restarting the API. Test records were cleaned up; final DB counts contain no test users/sessions.
- Imported 4 agents, 4 tasks, 1 run, 2 executions, and 2 evaluations transactionally. A second apply inserted 0 duplicates. Two timestamped pre-import backups exist; all source JSON files remain intact. Skipped 21 runs and 42 executions for unresolved parent/duplicate-ID relationships; reconciled 0.
- A live API check found parallel execution updates could leave a completed run marked `RUNNING`; added a transactional final status refresh and verified the completed status against PostgreSQL.
- Final offline verification: Prisma validation/generation, TypeScript, and production build PASS. Stages 3–8: 63 passed, 0 failed; Stage 9 auth/ownership suite PASS.
- Still NOT VERIFIED: Redis/BullMQ live processing, Docker workload execution, Bifrost live calls, production deployment, GitHub publication, and demo recording.
