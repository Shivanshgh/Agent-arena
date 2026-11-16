import assert from 'assert';
import { DockerExecutor } from '../server/infrastructure/docker-executor';
import { queueService, redisRetryDelay } from '../server/infrastructure/queue';
import { BifrostGateway } from '../server/infrastructure/bifrost';

async function runStage7Tests() {
  console.log('\n======================================================');
  console.log('  AgentArena — STAGE 7 Advanced Infrastructure Suite');
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
  // 1. Docker Isolation & Security Constraints
  // ---------------------------------------------------------
  await test('Docker: Security profile strictly enforces non-root, read-only, and network-disabled flags', async () => {
    const profile = DockerExecutor.getSecurityProfile();

    assert.strictEqual(profile.networkDisabled, true, 'Network must be strictly disabled');
    assert.strictEqual(profile.nonRootUser, true, 'Must run as non-root user');
    assert.strictEqual(profile.readOnlyRoot, true, 'Root filesystem must be read-only');
    assert.strictEqual(profile.memoryLimit, '512m');
    assert.strictEqual(profile.cpuLimit, '1.0');
    assert.strictEqual(profile.capDrop, 'ALL', 'All Linux capabilities must be dropped');
  });

  await test('Docker: Gracefully detects Docker daemon absence and reports BLOCKED_BY_EXTERNAL_INFRASTRUCTURE', async () => {
    const status = await DockerExecutor.checkAvailability();

    if (!status.available) {
      assert.strictEqual(status.status, 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE');
      assert(status.reason.length > 0);
    } else {
      assert.strictEqual(status.status, 'AVAILABLE');
    }
  });

  // ---------------------------------------------------------
  // 2. Redis & BullMQ Job Queue
  // ---------------------------------------------------------
  await test('Redis / BullMQ: Retries with bounded backoff and keeps recovery enabled outside tests', async () => {
    assert.strictEqual(redisRetryDelay(5), 2500);
    assert.strictEqual(redisRetryDelay(6), null);
    const oldEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try { assert.strictEqual(redisRetryDelay(100), 2500); }
    finally { process.env.NODE_ENV = oldEnvironment; }
  });

  await test('Redis / BullMQ: Handles offline Redis safely without throwing unhandled exceptions', async () => {
    const queueStatus = await queueService.getStatus();

    assert(queueStatus.redis.status === 'CONNECTED' || queueStatus.redis.status === 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE');
    assert.strictEqual(queueStatus.bullmq.queueName, 'benchmark-execution');
    assert.strictEqual(queueStatus.bullmq.concurrency, 5);
  });

  await test('Queue Idempotency: Provides idempotency contract using runId as unique jobId', async () => {
    const runId = `test-run-idempotent-${Date.now()}`;
    const res = await queueService.enqueueRunJob(runId, { taskId: 'task-1', runId });

    // In environment without Redis running, it gracefully returns enqueued: false with diagnostic reason
    if (!res.enqueued) {
      assert(res.reason?.includes('offline') || res.reason?.includes('unprovisioned'));
    } else {
      assert.strictEqual(res.jobId, runId);
    }
  });

  // ---------------------------------------------------------
  // 3. Bifrost Gateway Integration
  // ---------------------------------------------------------
  await test('Bifrost: Inspects provider status and redacts secret keys in status reports', async () => {
    const status = BifrostGateway.getStatus();

    assert('status' in status);
    assert(Array.isArray(status.supportedProviders));
    assert(status.supportedProviders.includes('openai'));
    assert(status.supportedProviders.includes('anthropic'));
    assert(status.supportedProviders.includes('deepseek'));
    assert(!('apiKey' in (status as any)), 'API Key MUST NOT be exposed in status payload');
  });

  await test('Bifrost: Gracefully handles unconfigured gateway without throwing fatal exceptions', async () => {
    const res = await BifrostGateway.queryModel({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'test prompt',
    });

    assert.strictEqual(res.success, false);
    assert(res.errorMessage?.includes('Bifrost Gateway is not configured') || res.errorMessage?.includes('error'));
  });

  await test('Bifrost: Rejects malformed model requests before network access', async () => {
    const result = await BifrostGateway.queryModel({ provider: 'openai', model: '', prompt: 'test' });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorMessage, 'Invalid Bifrost request.');
  });

  console.log('\n------------------------------------------------------');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage7Tests().catch(err => {
  console.error('Stage 7 test runner fatal error:', err);
  process.exit(1);
});
