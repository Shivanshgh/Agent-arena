import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must be configured in the ignored .env file.');
const target = new URL(databaseUrl);
if (target.hostname !== '127.0.0.1' || target.port !== '5432' || decodeURIComponent(target.username) !== 'postgres' || decodeURIComponent(target.pathname.slice(1)) !== 'agentarena_test') {
  throw new Error('Refusing to run: DATABASE_URL must target postgres@127.0.0.1:5432/agentarena_test.');
}

const prisma = new PrismaClient();
const marker = `PG integration ${randomUUID()}`;
const suffix = randomUUID();
const emailA = `pgverify-a-${suffix}@example.invalid`;
const emailB = `pgverify-b-${suffix}@example.invalid`;
const password = `Arena-test-${randomBytes(18).toString('hex')}!`;
const origin = { current: '' };
const agentIds = [];
let taskId;
let runId;
let modelRunId;
let evaluationIds = [];
const agentRequests = [];
const providerRequests = [];
let app;
let fixture;
let providerFixture;
const agentFixtures = [];
const agentEndpoints = new Map();
let passed = 0;
let apiBaseUrl;
let bifrostUrl;
let bifrostMode = 'valid';
let databaseConnected = false;
const pass = (name) => { console.log(`PASS ${name}`); passed++; };

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}

function startApi(port) {
  const env = {
    ...process.env, NODE_ENV: 'development', PORT: String(port),
    // Keep this non-queue integration suite away from any developer or production Redis.
    REDIS_URL: 'redis://127.0.0.1:1', REDIS_HOST: '127.0.0.1', REDIS_PORT: '1',
    AGENTARENA_WORKER_ENABLED: 'false',
    CORS_ORIGINS: origin.current, ALLOW_LOCAL_TEST_AGENTS: 'true', ENABLE_DEMO_SEED: 'false',
    BIFROST_ENDPOINT: bifrostUrl, BIFROST_API_KEY: 'integration-test-only',
    BIFROST_EVALUATION_PROVIDER: 'openai', BIFROST_EVALUATION_MODEL: 'openai/integration-test-model',
    AGENTARENA_ALLOW_LOCAL_PROVIDER_FIXTURE: 'true', AGENTARENA_TEST_PROVIDER_BASE_URL: providerFixture?.address()?.port ? `http://127.0.0.1:${providerFixture.address().port}` : '',
  };
  const child = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'server.ts')], {
    cwd: root, env, stdio: ['ignore', 'ignore', 'ignore'],
  });
  child.on('error', () => {});
  return child;
}

async function waitReady(baseUrl) {
  for (let i = 0; i < 60; i++) {
    if (!app || app.exitCode !== null) throw new Error('API process exited before readiness.');
    try {
      const response = await fetch(`${baseUrl}/api/ready`);
      if (response.ok) {
        const body = await response.json();
        if (body.database === 'connected') return;
      }
    } catch { /* API is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw new Error('API did not become database-ready.');
}

async function stopApi() {
  if (!app) return;
  const child = app;
  app = null;
  const responding = async () => {
    try { await fetch(`${apiBaseUrl}/api/health`, { signal: AbortSignal.timeout(400) }); return true; }
    catch { return false; }
  };
  if (child.exitCode === null) child.kill('SIGTERM');
  for (let i = 0; i < 12 && await responding(); i++) await new Promise(resolve => setTimeout(resolve, 250));
  if (await responding() && child.pid) {
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* process may already have exited */ }
  }
  for (let i = 0; i < 20 && await responding(); i++) await new Promise(resolve => setTimeout(resolve, 250));
  if (await responding()) {
    throw new Error('Test API still responds after shutdown; no restart was attempted.');
  }
}

async function call(baseUrl, route, { method = 'GET', cookie, body, requestOrigin = origin.current } = {}) {
  const headers = { Origin: requestOrigin };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await response.json(); } catch { /* caller checks the status */ }
  return { response, data };
}

async function expectStatus(baseUrl, route, status, options = {}) {
  const result = await call(baseUrl, route, options);
  assert.equal(result.response.status, status, `${options.method || 'GET'} ${route} status: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function login(baseUrl, email, userPassword) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { Origin: origin.current, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: userPassword }),
  });
  assert.equal(response.status, 200, 'login status');
  const cookieHeader = response.headers.get('set-cookie');
  assert.ok(cookieHeader, 'login sets a session cookie');
  return { cookie: cookieHeader.split(';')[0], user: (await response.json()).data };
}

async function cleanup() {
  await stopApi();
  if (!databaseConnected) return;
  await prisma.$connect();
  await prisma.$transaction(async tx => {
    const users = await tx.user.findMany({ where: { email: { in: [emailA, emailB] } }, select: { id: true } });
    const userIds = users.map(user => user.id);
    if (!userIds.length) return;
    const runs = await tx.benchmarkRun.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } });
    if (runs.length) await tx.benchmarkRun.deleteMany({ where: { id: { in: runs.map(run => run.id) } } });
    // Agent/Task owner FKs use SET NULL, so delete all rows owned by these unique test users first.
    await tx.agent.deleteMany({ where: { ownerId: { in: userIds } } });
    await tx.benchmarkTask.deleteMany({ where: { ownerId: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

try {
  await prisma.$connect();
  databaseConnected = true;
  const migrationRows = await prisma.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
  assert.ok(migrationRows.some(row => row.migration_name === '20261114000000_initial'));
  assert.ok(migrationRows.some(row => row.migration_name === '20261114120000_auth_and_ownership'));
  assert.ok(migrationRows.some(row => row.migration_name === '20261114190000_evaluation_relations'));
  assert.ok(migrationRows.some(row => row.migration_name === '20261120120000_model_benchmarking'));
  pass('PostgreSQL target and migrations');

  fixture = createHttpServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      assert.equal(req.headers.authorization, 'Bearer integration-test-only');
      assert.equal(request.model, 'openai/integration-test-model');
      if (bifrostMode === 'provider-error') return send(503, { error: 'fixture provider failure' });
      if (bifrostMode === 'invalid-response') return send(200, { choices: [{ message: { content: 'not-json' } }] });
      return send(200, { choices: [{ message: { content: JSON.stringify({ score: 88, rationale: 'The solution meets the stated requirement.', evidence: ['returns the reversed value'] }) } }], usage: { prompt_tokens: 100, completion_tokens: 25 } });
    }
    return send(404, { error: 'not found' });
  });
  const fixturePort = await listen(fixture);
  bifrostUrl = `http://127.0.0.1:${fixturePort}/v1`;
  providerFixture = createHttpServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/models') return send(200, {
      data: [{ id: 'mock-model-a' }, { id: 'mock-model-b' }],
      models: [{ name: 'models/mock-model-a', displayName: 'Mock A', supportedGenerationMethods: ['generateContent'] }, { name: 'models/mock-model-b', displayName: 'Mock B', supportedGenerationMethods: ['generateContent'] }],
    });
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    providerRequests.push({ path: req.url, body, headers: req.headers });
    const answer = body.model === 'mock-model-a' ? '42' : 'wrong';
    if (req.url?.includes(':generateContent')) return send(200, { candidates: [{ content: { parts: [{ text: answer }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1 } });
    if (req.url === '/messages') return send(200, { content: [{ type: 'text', text: answer }], usage: { input_tokens: 12, output_tokens: 1 } });
    if (req.url === '/responses') return send(200, { output_text: answer, usage: { input_tokens: 12, output_tokens: 1 } });
    if (req.url === '/chat/completions') return send(200, { choices: [{ message: { content: answer } }], usage: { prompt_tokens: 12, completion_tokens: 1 } });
    return send(404, { error: 'fixture endpoint not found' });
  });
  await listen(providerFixture);
  const solutions = {
    correct: 'def reverse_string(value):\n    return value[::-1]\n',
    partial: 'def reverse_string(value):\n    return value[:1]  # sample expected: cba\n',
    incorrect: 'def reverse_string(value):\n    return "cba"\n',
  };
  for (const [variant, code] of Object.entries(solutions)) {
    const agentServer = createHttpServer(async (req, res) => {
      const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.method === 'GET' && req.url === '/health') return send(200, { status: 'healthy', version: '1.0.0', capabilities: ['code_generation'] });
      if (req.method !== 'POST' || req.url !== '/execute') return send(404, { error: 'not found' });
      let raw = ''; for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      agentRequests.push({ variant, request });
      return send(200, {
        protocolVersion: '1.0', requestId: request.requestId, status: 'completed',
        result: { content: code, files: { 'solution.py': code } },
        metrics: { durationMs: 12, inputTokens: null, outputTokens: null }, error: null, metadata: { fixture: variant },
      });
    });
    agentFixtures.push(agentServer);
    agentEndpoints.set(variant, `http://127.0.0.1:${await listen(agentServer)}`);
  }
  const portServer = createNetServer();
  const port = await listen(portServer);
  await new Promise(resolve => portServer.close(resolve));
  origin.current = `http://127.0.0.1:${port}`;
  const baseUrl = origin.current;
  apiBaseUrl = baseUrl;
  app = startApi(port);
  await waitReady(baseUrl);
  await expectStatus(baseUrl, '/api/agents', 401);
  await expectStatus(baseUrl, '/api/auth/register', 403, { method: 'POST', body: { email: emailA, password }, requestOrigin: 'http://invalid.example' });
  pass('API readiness, unauthenticated denial, and origin protection');

  await expectStatus(baseUrl, '/api/auth/register', 201, { method: 'POST', body: { email: emailA, password } });
  const userRecord = await prisma.user.findUnique({ where: { email: emailA } });
  assert.ok(userRecord?.passwordHash.startsWith('scrypt$'));
  assert.notEqual(userRecord.passwordHash, password);
  assert.equal((await expectStatus(baseUrl, '/api/auth/login', 401, { method: 'POST', body: { email: emailA, password: `${password}wrong` } })).success, false);
  const userA = await login(baseUrl, emailA, password);
  assert.match(userA.cookie, /^agentarena_session=/);
  const meA = await expectStatus(baseUrl, '/api/auth/me', 200, { cookie: userA.cookie });
  assert.equal(meA.data.id, userRecord.id);
  const storedSession = await prisma.authSession.findFirst({ where: { userId: userRecord.id } });
  assert.ok(storedSession && storedSession.expiresAt > new Date());
  assert.notEqual(storedSession.tokenHash, decodeURIComponent(userA.cookie.split('=')[1]));
  const persistentLogin = await login(baseUrl, emailA, password);
  await expectStatus(baseUrl, '/api/auth/logout', 200, { method: 'POST', cookie: userA.cookie });
  await expectStatus(baseUrl, '/api/auth/me', 401, { cookie: userA.cookie });
  await expectStatus(baseUrl, '/api/auth/register', 201, { method: 'POST', body: { email: emailB, password } });
  const userB = await login(baseUrl, emailB, password);
  pass('User creation, password hashing, login, persisted sessions, and logout');

  const providerKey = 'integration-provider-key-not-real';
  const listedModels = await expectStatus(baseUrl, '/api/model-providers/test', 200, { method: 'POST', cookie: persistentLogin.cookie, body: { provider: 'OPENAI', apiKey: providerKey } });
  assert.equal(listedModels.data.models.length, 2);
  const modelA = await expectStatus(baseUrl, '/api/model-connections', 201, { method: 'POST', cookie: persistentLogin.cookie, body: { provider: 'OPENAI', apiKey: providerKey, modelId: 'mock-model-a' } });
  const modelB = await expectStatus(baseUrl, '/api/model-connections', 201, { method: 'POST', cookie: persistentLogin.cookie, body: { provider: 'OPENAI', apiKey: providerKey, modelId: 'mock-model-b' } });
  const storedProviderKey = await prisma.providerCredential.findUnique({ where: { ownerId_provider: { ownerId: userRecord.id, provider: 'OPENAI' } } });
  assert.ok(storedProviderKey && storedProviderKey.encryptedApiKey !== providerKey);
  assert.equal((await expectStatus(baseUrl, `/api/model-connections/${modelA.data.id}/test`, 200, { method: 'POST', cookie: persistentLogin.cookie })).data.status, 'CONNECTED');
  assert.ok(!JSON.stringify([modelA, modelB, listedModels]).includes(providerKey));
  assert.ok((await expectStatus(baseUrl, '/api/model-connections', 200, { cookie: persistentLogin.cookie })).data.every(connection => !JSON.stringify(connection).toLowerCase().includes('apikey')));
  assert.equal((await expectStatus(baseUrl, '/api/model-connections', 200, { cookie: userB.cookie })).data.length, 0);
  assert.equal((await call(baseUrl, `/api/model-connections/${modelA.data.id}`, { method: 'DELETE', cookie: userB.cookie })).response.status, 404);
  assert.equal((await call(baseUrl, `/api/model-connections/${modelA.data.id}/test`, { method: 'POST', cookie: userB.cookie })).response.status, 404);
  pass('Provider key validation, encrypted connection storage, and model ownership isolation');

  const agentLabel = `Audit ${suffix.slice(0, 8)}`;
  const agentInput = (name, variant) => ({ name, endpoint: agentEndpoints.get(variant), supportedLanguages: ['python'], authType: 'NONE', integrationType: 'HTTP' });
  const createdAgent1 = await expectStatus(baseUrl, '/api/agents?testImmediate=true', 201, { method: 'POST', cookie: persistentLogin.cookie, body: agentInput(`${agentLabel} correct`, 'correct') });
  const createdAgent2 = await expectStatus(baseUrl, '/api/agents', 201, { method: 'POST', cookie: persistentLogin.cookie, body: agentInput(`${agentLabel} partial`, 'partial') });
  const createdAgent3 = await expectStatus(baseUrl, '/api/agents', 201, { method: 'POST', cookie: persistentLogin.cookie, body: agentInput(`${agentLabel} incorrect`, 'incorrect') });
  const createdAgent4 = await expectStatus(baseUrl, '/api/agents', 201, { method: 'POST', cookie: persistentLogin.cookie, body: agentInput(`${agentLabel} delete`, 'correct') });
  agentIds.push(createdAgent1.data.id, createdAgent2.data.id, createdAgent3.data.id, createdAgent4.data.id);
  assert.equal(createdAgent1.initialConnectionTest.success, true);
  await expectStatus(baseUrl, `/api/agents/${createdAgent1.data.id}`, 200, { cookie: persistentLogin.cookie });
  const updatedAgent = await expectStatus(baseUrl, `/api/agents/${createdAgent2.data.id}`, 200, { method: 'PUT', cookie: persistentLogin.cookie, body: { description: 'PostgreSQL integration test' } });
  assert.equal(updatedAgent.data.description, 'PostgreSQL integration test');
  await expectStatus(baseUrl, `/api/agents/${createdAgent4.data.id}`, 200, { method: 'DELETE', cookie: persistentLogin.cookie });

  const taskBody = { title: `${marker} Reverse String`, description: 'Reverse any input string, including strings with arbitrary lengths.', language: 'python', difficulty: 'EASY', evaluationStrategy: 'HEURISTIC_TEXT', expectedOutput: 'cba', inputData: { value: 'abc' }, timeoutSeconds: 10, maxOutputSizeBytes: 10000 };
  const createdTask = await expectStatus(baseUrl, '/api/tasks', 201, { method: 'POST', cookie: persistentLogin.cookie, body: taskBody });
  taskId = createdTask.data.id;
  const spareTask = await expectStatus(baseUrl, '/api/tasks', 201, { method: 'POST', cookie: persistentLogin.cookie, body: { ...taskBody, title: `${marker} Spare Task` } });
  await expectStatus(baseUrl, `/api/tasks/${taskId}`, 200, { method: 'PUT', cookie: persistentLogin.cookie, body: { category: 'Database Verification' } });
  await expectStatus(baseUrl, `/api/tasks/${spareTask.data.id}`, 200, { method: 'DELETE', cookie: persistentLogin.cookie });
  pass('Agent and task create/read/update/delete');

  const exactTask = await expectStatus(baseUrl, '/api/tasks', 201, { method: 'POST', cookie: persistentLogin.cookie, body: {
    title: `${marker} Exact Answer`, description: 'Return the exact expected answer for scoring.', language: 'text', category: 'Model Fixture', difficulty: 'EASY',
    inputData: { question: 'What is six times seven?' }, expectedOutput: '42', evaluationStrategy: 'EXACT_MATCH', timeoutSeconds: 10, maxOutputSizeBytes: 10000,
  } });
  const modelRun = await expectStatus(baseUrl, '/api/runs?wait=true', 201, { method: 'POST', cookie: persistentLogin.cookie, body: {
    title: `${marker} Model Comparison`, taskId: exactTask.data.id, modelConnectionIds: [modelA.data.id, modelB.data.id],
  } });
  modelRunId = modelRun.data.id;
  assert.equal(modelRun.data.status, 'COMPLETED');
  assert.equal(modelRun.data.modelExecutions.length, 2);
  assert.ok(modelRun.data.modelExecutions.every(execution => execution.status === 'COMPLETED' && execution.inputTokens === 12));
  const modelInputs = providerRequests.filter(request => request.path === '/responses').map(request => request.body.input);
  assert.equal(modelInputs.length, 2);
  assert.equal(modelInputs[0], modelInputs[1], 'every selected model receives the identical task prompt');
  assert.equal((await call(baseUrl, `/api/runs/${modelRunId}`, { cookie: userB.cookie })).response.status, 404);
  const modelEvaluations = await expectStatus(baseUrl, `/api/runs/${modelRunId}/evaluate`, 200, { method: 'POST', cookie: persistentLogin.cookie, body: {} });
  assert.deepEqual(modelEvaluations.data.map(item => item.evaluation?.accuracyScore).sort(), [0, 100]);
  assert.ok(modelEvaluations.data.every(item => item.evaluation?.evaluationStatus === 'VERIFIED_EXACT_MATCH'));
  const modelRanks = await expectStatus(baseUrl, '/api/leaderboard/models', 200, { cookie: persistentLogin.cookie });
  assert.equal(modelRanks.data.length, 2);
  assert.equal(modelRanks.data[0].accuracyScore, 100);
  assert.equal((await expectStatus(baseUrl, '/api/leaderboard/models', 200, { cookie: userB.cookie })).data.length, 0);
  pass('Two-model identical-input run, distinct responses, exact scoring, separate leaderboard, and ownership');

  const createdRun = await expectStatus(baseUrl, '/api/runs?wait=true', 201, { method: 'POST', cookie: persistentLogin.cookie, body: { title: marker, taskId, agentIds: [createdAgent1.data.id, createdAgent2.data.id, createdAgent3.data.id] } });
  runId = createdRun.data.id;
  assert.equal(createdRun.data.status, 'COMPLETED');
  assert.equal(createdRun.data.executions.length, 3);
  assert.ok(createdRun.data.executions.every(execution => execution.status === 'COMPLETED'));
  assert.deepEqual(agentRequests.map(item => item.variant).sort(), ['correct', 'incorrect', 'partial']);
  assert.ok(agentRequests.every(item => item.request.task.taskId === taskId && item.request.task.input.value === 'abc'));
  const resultByAgent = new Map(createdRun.data.executions.map(execution => [execution.agentId, execution.rawOutput]));
  assert.match(resultByAgent.get(createdAgent1.data.id), /value\[::\-1\]/);
  assert.match(resultByAgent.get(createdAgent2.data.id), /value\[:1\]/);
  assert.match(resultByAgent.get(createdAgent3.data.id), /return "cba"/);
  const evaluated = await expectStatus(baseUrl, `/api/runs/${runId}/evaluate`, 200, { method: 'POST', cookie: persistentLogin.cookie, body: {} });
  evaluationIds = evaluated.data.map(evaluation => evaluation.id);
  assert.equal(evaluationIds.length, 3);
  const byAgent = new Map(evaluated.data.map(evaluation => [evaluation.agentId, evaluation]));
  const correctScore = byAgent.get(createdAgent1.data.id);
  const partialScore = byAgent.get(createdAgent2.data.id);
  const incorrectScore = byAgent.get(createdAgent3.data.id);
  assert.equal(correctScore.accuracyScore, 75, 'correct general solution fails literal expected-output substring heuristic');
  assert.equal(partialScore.accuracyScore, 100, 'partial solution passes because its comment contains the sample expected output');
  assert.equal(incorrectScore.accuracyScore, 100, 'constant wrong general solution passes because it contains the sample expected output');
  assert.equal(correctScore.speedScore, 100);
  assert.equal(correctScore.reliabilityScore, 100);
  assert.equal(correctScore.costEfficiencyScore, null);
  assert.equal(correctScore.overallScore, 86);
  const aiEvaluated = await expectStatus(baseUrl, `/api/runs/${runId}/evaluate?recalculate=true`, 200, { method: 'POST', cookie: persistentLogin.cookie, body: { aiAssisted: true } });
  assert.ok(aiEvaluated.data.every(evaluation => evaluation.breakdown.semanticReview?.score === 88));
  assert.ok(aiEvaluated.data.every(evaluation => evaluation.breakdown.semanticReview?.provider === 'openai' && evaluation.breakdown.semanticReview?.model === 'openai/integration-test-model'));
  assert.deepEqual(aiEvaluated.data.map(evaluation => evaluation.overallScore), evaluated.data.map(evaluation => evaluation.overallScore));
  const storedAiEvaluations = await prisma.executionEvaluation.findMany({ where: { runId }, orderBy: { executionId: 'asc' } });
  assert.ok(storedAiEvaluations.every(evaluation => evaluation.breakdown.semanticReview.score === 88));
  pass('AI semantic review validated, kept separate from deterministic scores, and persisted in PostgreSQL');
  for (const mode of ['invalid-response', 'provider-error']) {
    bifrostMode = mode;
    const failedReview = await call(baseUrl, `/api/runs/${runId}/evaluate?recalculate=true`, { method: 'POST', cookie: persistentLogin.cookie, body: { aiAssisted: true } });
    assert.equal(failedReview.response.status, 502);
    const unchanged = await prisma.executionEvaluation.findMany({ where: { runId } });
    assert.ok(unchanged.every(evaluation => evaluation.breakdown.semanticReview.score === 88));
  }
  bifrostMode = 'valid';
  pass('Provider and invalid semantic responses fail explicitly without replacing persisted evaluations');
  const leader = await expectStatus(baseUrl, '/api/leaderboard', 200, { cookie: persistentLogin.cookie });
  assert.ok(leader.data.length >= 2);
  const incorrectRank = leader.data.find(entry => entry.agentId === createdAgent3.data.id)?.rank;
  const correctRank = leader.data.find(entry => entry.agentId === createdAgent1.data.id)?.rank;
  assert.ok(incorrectRank < correctRank, 'leaderboard ranks the known incorrect constant-output agent above the correct general solution, exposing heuristic inversion');
  pass('Three independent HTTP agents receive the same task; results, heuristic scores, and leaderboard persist');

  for (const route of [`/api/agents/${createdAgent1.data.id}`, `/api/tasks/${taskId}`, `/api/runs/${runId}`, `/api/evaluations/${evaluationIds[0]}`, `/api/runs/${runId}/evaluations`]) {
    await expectStatus(baseUrl, route, 404, { cookie: userB.cookie });
  }
  await expectStatus(baseUrl, `/api/agents/${createdAgent1.data.id}`, 404, { method: 'PUT', cookie: userB.cookie, body: { name: `${marker} takeover` } });
  await expectStatus(baseUrl, `/api/agents/${createdAgent1.data.id}`, 404, { method: 'DELETE', cookie: userB.cookie });
  await expectStatus(baseUrl, `/api/tasks/${taskId}`, 404, { method: 'PUT', cookie: userB.cookie, body: { title: `${marker} takeover` } });
  const privateLists = await Promise.all(['/api/agents', '/api/tasks', '/api/runs'].map(route => call(baseUrl, route, { cookie: userB.cookie })));
  assert.ok(privateLists.every(item => item.response.ok));
  assert.ok(!privateLists[0].data.data.some(item => agentIds.includes(item.id)));
  assert.ok(!privateLists[1].data.data.some(item => item.id === taskId));
  assert.equal(privateLists[1].data.data.length, 4, 'platform-shared imported tasks remain available');
  assert.ok(!privateLists[2].data.data.some(item => item.id === runId));
  pass('Cross-user reads, writes, deletes, and private lists denied');

  await stopApi();
  app = startApi(port);
  await waitReady(baseUrl);
  const persistedUser = await expectStatus(baseUrl, '/api/auth/me', 200, { cookie: persistentLogin.cookie });
  assert.equal(persistedUser.data.email, emailA);
  const persistedRun = await expectStatus(baseUrl, `/api/runs/${runId}`, 200, { cookie: persistentLogin.cookie });
  assert.equal(persistedRun.data.executions.length, 3);
  assert.ok(persistedRun.data.executions.every(execution => execution.status === 'COMPLETED' && execution.rawOutput));
  const persistedEvaluations = await expectStatus(baseUrl, `/api/runs/${runId}/evaluations`, 200, { cookie: persistentLogin.cookie });
  assert.equal(persistedEvaluations.data.length, 3);
  assert.ok(persistedEvaluations.data.every(evaluation => evaluation.breakdown.semanticReview?.score === 88));
  const persistedModels = await expectStatus(baseUrl, `/api/runs/${modelRunId}`, 200, { cookie: persistentLogin.cookie });
  assert.ok(persistedModels.data.modelExecutions.every(execution => execution.status === 'COMPLETED' && execution.evaluation?.evaluationStatus === 'VERIFIED_EXACT_MATCH'));
  await expectStatus(baseUrl, `/api/model-connections/${modelA.data.id}`, 200, { method: 'DELETE', cookie: persistentLogin.cookie });
  await expectStatus(baseUrl, `/api/model-connections/${modelB.data.id}`, 200, { method: 'DELETE', cookie: persistentLogin.cookie });
  const retainedModelHistory = await prisma.modelExecution.findMany({ where: { runId: modelRunId } });
  assert.equal(retainedModelHistory.length, 2);
  assert.ok(retainedModelHistory.every(execution => execution.connectionId === null), 'deleting model connections must retain run history');
  assert.equal(await prisma.providerCredential.count({ where: { ownerId: userRecord.id, provider: 'OPENAI' } }), 0, 'unused encrypted provider key should be deleted with final connection');
  pass('Model connection deletion removes unused key but preserves benchmark history');
  await expectStatus(baseUrl, '/api/auth/logout', 200, { method: 'POST', cookie: persistentLogin.cookie });
  await expectStatus(baseUrl, '/api/auth/me', 401, { cookie: persistentLogin.cookie });
  pass('Session, run, executions, and evaluations persist after API restart');
} finally {
  await stopApi().catch(() => {});
  if (fixture?.listening) await new Promise(resolve => fixture.close(resolve));
  if (providerFixture?.listening) await new Promise(resolve => providerFixture.close(resolve));
  await Promise.all(agentFixtures.filter(server => server.listening).map(server => new Promise(resolve => server.close(resolve))));
  await cleanup();
  await prisma.$disconnect();
}

console.log(`PostgreSQL integration checks: ${passed} passed; temporary test records cleaned up.`);
