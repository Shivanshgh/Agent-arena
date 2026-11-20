# Remaining Work (Prioritized)

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
