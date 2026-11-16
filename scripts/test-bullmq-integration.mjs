import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbUrl = new URL(process.env.DATABASE_URL || '');
const redisUrl = new URL(process.env.REDIS_URL || '');
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.equal(dbUrl.port, '5432');
assert.equal(decodeURIComponent(dbUrl.pathname.slice(1)), 'agentarena_test');
assert.equal(redisUrl.protocol, 'rediss:');
const prisma = new PrismaClient();
const uid = randomUUID();
const marker = `BullMQ verification ${uid}`;
const email = `bullmq-${uid}@example.invalid`;
const password = `Arena-test-${randomBytes(18).toString('hex')}!`;
let fixture, api, worker, runId, taskId;
const agentIds = [];
let apiUrl;

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
function child(script, env) {
  const p = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, script)], { cwd: root, env, stdio: 'ignore' });
  p.on('error', () => {});
  return p;
}
async function stop(p, url) {
  if (!p) return;
  p.kill('SIGTERM');
  for (let i = 0; i < 20; i++) {
    try { if (url) await fetch(url, { signal: AbortSignal.timeout(200) }); else if (p.exitCode !== null) return; }
    catch { return; }
    await new Promise(r => setTimeout(r, 250));
  }
  if (p.exitCode === null && p.pid) try { execFileSync('taskkill.exe', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
}
async function request(route, { method = 'GET', cookie, body } = {}) {
  const headers = { Origin: apiUrl };
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(apiUrl + route, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${route} returned ${response.status}`);
  return data;
}
async function cleanup() {
  await stop(api, apiUrl && apiUrl + '/api/health'); api = null;
  await stop(worker); worker = null;
  if (fixture?.listening) await new Promise(resolve => fixture.close(resolve));
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) await prisma.$transaction(async tx => {
    await tx.benchmarkRun.deleteMany({ where: { ownerId: user.id, title: marker } });
    await tx.agent.deleteMany({ where: { ownerId: user.id, id: { in: agentIds } } });
    if (taskId) await tx.benchmarkTask.deleteMany({ where: { ownerId: user.id, id: taskId } });
    await tx.authSession.deleteMany({ where: { userId: user.id } });
    await tx.agent.deleteMany({ where: { ownerId: user.id } });
    await tx.benchmarkTask.deleteMany({ where: { ownerId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
  });
}

try {
  assert.ok(redisUrl.hostname && redisUrl.password, 'REDIS_URL must include Upstash credentials');
  console.log('PASS ignored .env REDIS_URL loaded; rediss TLS configured');
  fixture = createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/health') return send(200, { status: 'healthy', version: '1.0.0' });
    if (req.url === '/execute') {
      let raw = ''; for await (const part of req) raw += part;
      const input = JSON.parse(raw);
      const code = 'def reverse_string(value):\n    return "cba"\n';
      return send(200, { protocolVersion: '1.0', requestId: input.requestId, status: 'completed', result: { content: code, files: { 'solution.py': code } }, metrics: { durationMs: 10 }, error: null, metadata: {} });
    }
    send(404, {});
  });
  const fixturePort = await listen(fixture);
  const net = createNetServer(); const port = await listen(net); await new Promise(r => net.close(r));
  apiUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: 'development', PORT: String(port), CORS_ORIGINS: apiUrl, ALLOW_LOCAL_TEST_AGENTS: 'true', ENABLE_DEMO_SEED: 'false' };
  worker = child('worker.ts', env);
  api = child('server.ts', env);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(apiUrl + '/api/ready'); if (r.ok && (await r.json()).database === 'connected') { ready = true; break; } } catch {}
    if (api.exitCode !== null || worker.exitCode !== null) throw new Error('API or worker exited during startup');
    await new Promise(r => setTimeout(r, 350));
  }
  assert.ok(ready, 'API did not become ready');
  await request('/api/auth/register', { method: 'POST', body: { email, password } });
  const loggedIn = await fetch(apiUrl + '/api/auth/login', { method: 'POST', headers: { Origin: apiUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(loggedIn.status, 200);
  const cookie = loggedIn.headers.get('set-cookie').split(';')[0];
  let queueReady = false;
  let lastQueueStatus;
  for (let i = 0; i < 30; i++) {
    const health = await (await fetch(apiUrl + '/api/infrastructure/status', { headers: { Origin: apiUrl, Cookie: cookie } })).json();
    lastQueueStatus = { redis: health.data?.redis?.status, bullmq: health.data?.bullmq?.status };
    if (health.data?.redis?.status === 'CONNECTED' && health.data?.bullmq?.status === 'ACTIVE') { queueReady = true; break; }
    await new Promise(r => setTimeout(r, 350));
  }
  assert.ok(queueReady, `API BullMQ queue did not connect: ${JSON.stringify(lastQueueStatus)}`);
  console.log('PASS API and BullMQ worker started; queue active');
  const endpoint = `http://127.0.0.1:${fixturePort}`;
  for (let i = 0; i < 2; i++) {
    const result = await request('/api/agents', { method: 'POST', cookie, body: { name: `${marker} agent ${i}`, endpoint, supportedLanguages: ['python'], authType: 'NONE', integrationType: 'HTTP' } });
    agentIds.push(result.data.id);
  }
  const task = await request('/api/tasks', { method: 'POST', cookie, body: { title: marker, description: 'BullMQ integration check', language: 'python', difficulty: 'EASY', expectedOutput: 'cba', inputData: { value: 'abc' }, timeoutSeconds: 10, maxOutputSizeBytes: 10000 } });
  taskId = task.data.id;
  const started = await request('/api/runs', { method: 'POST', cookie, body: { title: marker, taskId, agentIds } });
  runId = started.data.id;
  assert.equal(started.data.status, 'QUEUED', 'API should return before worker execution');
  let run;
  for (let i = 0; i < 90; i++) {
    run = (await request(`/api/runs/${runId}`, { cookie })).data;
    if (['COMPLETED', 'FAILED', 'PARTIALLY_FAILED'].includes(run.status)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert.equal(run?.status, 'COMPLETED');
  assert.equal(run.executions.length, 2);
  assert.ok(run.executions.every(e => e.status === 'COMPLETED' && e.rawOutput));
  const persisted = await prisma.benchmarkRun.findUnique({ where: { id: runId }, include: { executions: true } });
  assert.equal(persisted?.executions.length, 2);
  assert.ok(persisted.executions.every(e => e.status === 'COMPLETED' && e.rawOutput));
  console.log('PASS API benchmark was queued, worker completed both executions, PostgreSQL persisted results');

  const { Queue } = await import('bullmq');
  const retryQueue = new Queue('benchmark-execution', { connection: {
    host: redisUrl.hostname, port: Number(redisUrl.port || 6379),
    username: decodeURIComponent(redisUrl.username) || undefined,
    password: decodeURIComponent(redisUrl.password) || undefined,
    db: Number(redisUrl.pathname.slice(1)) || 0, tls: {}, maxRetriesPerRequest: null,
  } });
  const retryJob = await retryQueue.add('test-failure-retry', { runId: `missing-${uid}` }, {
    jobId: `retrycheck-${uid}`, attempts: 2, backoff: { type: 'exponential', delay: 100 },
  });
  for (let i = 0; i < 40 && (await retryJob.getState()) !== 'failed'; i++) await new Promise(r => setTimeout(r, 250));
  assert.equal(await retryJob.getState(), 'failed');
  const finalRetryJob = await retryQueue.getJob(retryJob.id);
  assert.equal(finalRetryJob.attemptsMade, 2);
  await finalRetryJob.remove();
  await retryQueue.close();
  console.log('PASS BullMQ worker retries a failed job twice and records terminal failure');

  await stop(api, apiUrl + '/api/health'); api = child('server.ts', env);
  let restarted = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(apiUrl + '/api/ready'); if (r.ok && (await r.json()).database === 'connected') { restarted = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 350));
  }
  assert.ok(restarted);
  const reloaded = (await request(`/api/runs/${runId}`, { cookie })).data;
  assert.equal(reloaded.status, 'COMPLETED');
  assert.ok(reloaded.executions.every(e => e.status === 'COMPLETED'));
  console.log('PASS queued run and execution results remain available after API restart');
} finally {
  await cleanup().catch(() => {});
  await prisma.$disconnect();
}
