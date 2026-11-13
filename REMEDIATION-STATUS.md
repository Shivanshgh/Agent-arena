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
