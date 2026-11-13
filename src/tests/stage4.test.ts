import http from 'http';
import assert from 'assert';
import { benchmarkDb } from '../server/benchmark-db';
import { agentDb } from '../server/db';
import { BenchmarkOrchestrator } from '../server/orchestrator';

async function runStage4Tests() {
  console.log('\n======================================================');
  console.log('  AgentArena — STAGE 4 Benchmark Orchestration Suite');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      process.stdout.write(`• Testing: ${name} ... `);
      await fn();
      console.log('✓ PASS');
      passed++;
    } catch (err: any) {
      console.log('✗ FAIL');
      console.error(`  Error: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(0, 3).join('\n'));
      failed++;
    }
  }

  // ---------------------------------------------------------
  // 1. Benchmark Task CRUD & Validation
  // ---------------------------------------------------------
  let createdTaskId = '';

  await test('Task CRUD: Creates benchmark task with proper validation defaults', async () => {
    const task = benchmarkDb.createTask({
      title: 'Valid Palindrome II',
      description: 'Given a string s, return true if the s can be palindrome after deleting at most one character.',
      language: 'python',
      category: 'String Manipulation',
      difficulty: 'EASY',
      inputData: { s: 'abca' },
      expectedOutput: 'true',
      timeoutSeconds: 20,
      maxOutputSizeBytes: 50000,
      isActive: true,
    });

    assert(task.id, 'Task must have generated ID');
    assert.strictEqual(task.title, 'Valid Palindrome II');
    assert.strictEqual(task.timeoutSeconds, 20);
    assert.strictEqual(task.difficulty, 'EASY');
    createdTaskId = task.id;
  });

  await test('Task CRUD: Reads and lists benchmark tasks', async () => {
    const task = benchmarkDb.getTask(createdTaskId);
    assert(task !== null, 'Task must exist');
    assert.strictEqual(task?.title, 'Valid Palindrome II');

    const allTasks = benchmarkDb.listTasks();
    assert(allTasks.length >= 1, 'Should return non-empty task list');
  });

  await test('Task CRUD: Updates task properties cleanly', async () => {
    const updated = benchmarkDb.updateTask(createdTaskId, {
      difficulty: 'MEDIUM',
      timeoutSeconds: 40,
    });
    assert.strictEqual(updated?.difficulty, 'MEDIUM');
    assert.strictEqual(updated?.timeoutSeconds, 40);
  });

  await test('Task CRUD: Deletes benchmark task', async () => {
    const deleted = benchmarkDb.deleteTask(createdTaskId);
    assert.strictEqual(deleted, true);

    const check = benchmarkDb.getTask(createdTaskId);
    assert.strictEqual(check, null);
  });

  // ---------------------------------------------------------
  // 2. Setup Multi-Agent Mock Test Server
  // ---------------------------------------------------------
  let mockServer: http.Server;
  let mockPort: number = 0;
  const receivedRequests: Array<{ agentKey: string; body: any }> = [];

  await test('Fixture: Spin up multi-agent test server for execution testing', async () => {
    await new Promise<void>(resolve => {
      mockServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const parsed = body ? JSON.parse(body) : {};
          const url = new URL(req.url || '/', 'http://127.0.0.1');

          if (url.pathname === '/agent-a/execute') {
            receivedRequests.push({ agentKey: 'agent-a', body: parsed });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              protocolVersion: '1.0',
              requestId: parsed.requestId,
              status: 'completed',
              result: { content: 'def isPalindrome(s): return True' },
              metrics: { durationMs: 40, inputTokens: 50, outputTokens: 25 },
              error: null,
              metadata: { agent: 'Agent Alpha' },
            }));
          }

          if (url.pathname === '/agent-b/execute') {
            receivedRequests.push({ agentKey: 'agent-b', body: parsed });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              protocolVersion: '1.0',
              requestId: parsed.requestId,
              status: 'completed',
              result: { content: 'def solve(): return "Solution from Beta"' },
              metrics: { durationMs: 65, inputTokens: null, outputTokens: null }, // Null metrics allowed
              error: null,
              metadata: { agent: 'Agent Beta' },
            }));
          }

          if (url.pathname === '/agent-fail/execute') {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Crash inside agent pipeline' }));
          }

          if (url.pathname === '/agent-timeout/execute') {
            // Keep request hanging
            return;
          }

          res.writeHead(404);
          res.end();
        });
      });

      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = (mockServer.address() as any).port;
        resolve();
      });
    });

    assert(mockPort > 0);
  });

  // Register test agents
  const agentA = agentDb.create({
    name: 'Stage4 Test Agent Alpha',
    description: 'Fast solver agent for testing',
    version: '1.0.0',
    integrationType: 'HTTP',
    endpoint: `http://127.0.0.1:${mockPort}/agent-a`,
    supportedLanguages: ['python'],
    supportedCapabilities: ['code_generation'],
    authType: 'NONE',
  });

  const agentB = agentDb.create({
    name: 'Stage4 Test Agent Beta',
    description: 'Secondary solver agent for testing',
    version: '1.0.0',
    integrationType: 'HTTP',
    endpoint: `http://127.0.0.1:${mockPort}/agent-b`,
    supportedLanguages: ['python'],
    supportedCapabilities: ['code_generation'],
    authType: 'NONE',
  });

  const agentFail = agentDb.create({
    name: 'Stage4 Failing Agent',
    description: 'Agent designed to return 500 error',
    version: '1.0.0',
    integrationType: 'HTTP',
    endpoint: `http://127.0.0.1:${mockPort}/agent-fail`,
    supportedLanguages: ['python'],
    supportedCapabilities: ['code_generation'],
    authType: 'NONE',
  });

  const testTask = benchmarkDb.createTask({
    title: 'Two Sum Evaluation Challenge',
    description: 'Find two numbers that add up to target',
    language: 'python',
    category: 'Algorithms',
    difficulty: 'EASY',
    inputData: { nums: [2, 7, 11, 15], target: 9 },
    timeoutSeconds: 5,
  });

  // ---------------------------------------------------------
  // 3. Benchmark Orchestration Validation
  // ---------------------------------------------------------
  await test('Orchestrator: Rejects run with fewer than 2 agents', async () => {
    let errorCaught = false;
    try {
      await BenchmarkOrchestrator.createAndLaunchRun({
        taskId: testTask.id,
        agentIds: [agentA.id], // Only 1 agent!
      });
    } catch (err: any) {
      errorCaught = true;
      assert(err.message.includes('At least two eligible agents'));
    }
    assert.strictEqual(errorCaught, true);
  });

  await test('Orchestrator: Dispatches identical task payload to multiple agents and collects results', async () => {
    receivedRequests.length = 0; // Clear history

    const run = await BenchmarkOrchestrator.createAndLaunchRun(
      {
        title: 'Two Sum Head-to-Head Battle',
        taskId: testTask.id,
        agentIds: [agentA.id, agentB.id],
      },
      { waitForCompletion: true }
    );

    assert(run.id.startsWith('run-'), 'Run must have formatted ID');
    assert.strictEqual(run.status, 'COMPLETED');
    assert.strictEqual(run.executions.length, 2);

    // Verify executions completed
    const execA = run.executions.find(e => e.agentId === agentA.id);
    const execB = run.executions.find(e => e.agentId === agentB.id);

    assert(execA && execA.status === 'COMPLETED');
    assert(execB && execB.status === 'COMPLETED');
    assert(execA.rawOutput?.includes('isPalindrome'));
    assert(execB.rawOutput?.includes('Solution from Beta'));
    assert.strictEqual(execA.inputTokens, 50);
    assert.strictEqual(execB.inputTokens, null, 'Unreported tokens must stay null, never 0');

    // Verify identical task payload received by both agents
    assert.strictEqual(receivedRequests.length, 2);
    const reqA = receivedRequests.find(r => r.agentKey === 'agent-a')?.body;
    const reqB = receivedRequests.find(r => r.agentKey === 'agent-b')?.body;

    assert.strictEqual(reqA.task.taskId, testTask.id);
    assert.strictEqual(reqB.task.taskId, testTask.id);
    assert.strictEqual(reqA.task.title, reqB.task.title);
    assert.strictEqual(reqA.task.description, reqB.task.description);
    assert.deepStrictEqual(reqA.task.input, reqB.task.input);
    assert.strictEqual(reqA.constraints.timeoutSeconds, reqB.constraints.timeoutSeconds);
  });

  await test('Orchestrator: Handles partial failure without failing other agents (Run marked PARTIALLY_FAILED)', async () => {
    const run = await BenchmarkOrchestrator.createAndLaunchRun(
      {
        title: 'Reliability Test: Healthy vs Crashing Agent',
        taskId: testTask.id,
        agentIds: [agentA.id, agentFail.id],
      },
      { waitForCompletion: true }
    );

    assert.strictEqual(run.status, 'PARTIALLY_FAILED');
    const execSuccess = run.executions.find(e => e.agentId === agentA.id);
    const execFail = run.executions.find(e => e.agentId === agentFail.id);

    assert.strictEqual(execSuccess?.status, 'COMPLETED');
    assert.strictEqual(execFail?.status, 'FAILED');
    assert(execFail?.errorMessage?.includes('HTTP error 500'));
  });

  // Clean up
  agentDb.delete(agentA.id);
  agentDb.delete(agentB.id);
  agentDb.delete(agentFail.id);
  benchmarkDb.deleteTask(testTask.id);
  await new Promise<void>(resolve => mockServer.close(() => resolve()));

  console.log('\n------------------------------------------------------');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage4Tests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
