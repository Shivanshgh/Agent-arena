import assert from 'assert';
import { EvaluationEngine } from '../server/evaluation-engine';
import { evaluationDb } from '../server/evaluation-db';
import { DEFAULT_EVALUATION_WEIGHTS } from '../types/evaluation';
import { BenchmarkTask, AgentExecution } from '../types/benchmark';

async function runStage5Tests() {
  console.log('\n======================================================');
  console.log('  AgentArena — STAGE 5 Evaluation Engine Verification');
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
  // 1. Centralized Weights Configuration
  // ---------------------------------------------------------
  await test('Weights: Configured default weights sum to exactly 1.0 (100%)', async () => {
    const w = DEFAULT_EVALUATION_WEIGHTS;
    assert.strictEqual(w.accuracy, 0.40);
    assert.strictEqual(w.completion, 0.25);
    assert.strictEqual(w.reliability, 0.15);
    assert.strictEqual(w.speed, 0.10);
    assert.strictEqual(w.costEfficiency, 0.10);

    const sum = w.accuracy + w.completion + w.reliability + w.speed + w.costEfficiency;
    assert(Math.abs(sum - 1.0) < 0.0001, 'Weights must sum to 1.0');
  });

  await test('Weights: Rejects custom weights that do not sum to 1.0', async () => {
    let errorCaught = false;
    try {
      new EvaluationEngine({ accuracy: 0.5, completion: 0.2 }); // Total 0.70 != 1.0
    } catch (e: any) {
      errorCaught = true;
      assert(e.message.includes('Evaluation weights must sum to 1.0'));
    }
    assert.strictEqual(errorCaught, true);
  });

  // ---------------------------------------------------------
  // 2. Deterministic Scoring Evaluation
  // ---------------------------------------------------------
  const sampleTask: BenchmarkTask = {
    id: 'task-two-sum-eval',
    title: 'Two Sum Problem',
    description: 'Find two indices that sum up to target',
    language: 'python',
    category: 'Algorithms',
    difficulty: 'EASY',
    inputData: { nums: [2, 7, 11, 15], target: 9 },
    expectedOutput: '[0, 1]',
    evaluationStrategy: 'HEURISTIC_TEXT',
    timeoutSeconds: 30,
    maxOutputSizeBytes: 100000,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleCompletedExecution: AgentExecution = {
    id: 'exec-agent-alpha-001',
    runId: 'run-eval-test-01',
    agentId: 'agent-alpha',
    agentName: 'Alpha Agent',
    agentEndpoint: 'http://localhost:3000/agent',
    requestId: 'req-001',
    status: 'COMPLETED',
    startedAt: new Date(Date.now() - 250).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 250,
    inputTokens: 120,
    outputTokens: 80,
    errorMessage: null,
    rawOutput: 'def twoSum(nums, target):\n    # return [0, 1]\n    return [0, 1]\n',
    metadata: {},
  };

  const engine = new EvaluationEngine();

  await test('Accuracy & Tests: Evaluates completed execution against test cases', async () => {
    const evaluation = engine.evaluateExecution(sampleTask, sampleCompletedExecution);

    assert(evaluation.id.startsWith('eval-'));
    assert.strictEqual(evaluation.evaluationStatus, 'HEURISTIC');
    assert.strictEqual(evaluation.evaluationVersion, '1.1.0');
    assert((evaluation.accuracyScore ?? 0) > 75, `Heuristic diagnostic should be high, got ${evaluation.accuracyScore}`);
    assert(evaluation.passedTestCount >= 3, 'At least 3 test cases should pass');
    assert.strictEqual(evaluation.completionScore, 100);
    assert.strictEqual(evaluation.reliabilityScore, 100);
    assert(evaluation.speedScore >= 90, 'Fast execution should receive high speed score');
    assert(evaluation.costEfficiencyScore !== null && evaluation.costEfficiencyScore > 80);
    assert((evaluation.overallScore ?? 0) >= 85, `Heuristic diagnostic should be high, got ${evaluation.overallScore}`);
  });

  await test('Code correctness: stays unverified without an isolated code test runner', async () => {
    const evaluation = engine.evaluateExecution({ ...sampleTask, evaluationStrategy: 'CODE_UNVERIFIED' }, sampleCompletedExecution);
    assert.equal(evaluation.accuracyScore, null);
    assert.equal(evaluation.overallScore, null);
    assert.equal(evaluation.evaluationStatus, 'UNVERIFIED');
    assert.equal(evaluation.totalTestCount, 0);
  });

  await test('Task-specific exact and JSON evaluation rejects wrong or malformed answers', async () => {
    const exact = engine.evaluateExecution({ ...sampleTask, evaluationStrategy: 'EXACT_MATCH', expectedOutput: '42' }, { ...sampleCompletedExecution, rawOutput: '42' });
    const wrong = engine.evaluateExecution({ ...sampleTask, evaluationStrategy: 'EXACT_MATCH', expectedOutput: '42' }, { ...sampleCompletedExecution, rawOutput: 'forty two' });
    const json = engine.evaluateExecution({ ...sampleTask, evaluationStrategy: 'JSON_EXACT', expectedOutput: '{"a":1,"b":2}' }, { ...sampleCompletedExecution, rawOutput: '{"b":2,"a":1}' });
    const malformed = engine.evaluateExecution({ ...sampleTask, evaluationStrategy: 'JSON_EXACT', expectedOutput: '{"a":1}' }, { ...sampleCompletedExecution, rawOutput: 'not-json' });
    assert.equal(exact.accuracyScore, 100); assert.equal(exact.evaluationStatus, 'EVALUATED');
    assert.equal(wrong.accuracyScore, 0); assert.equal(json.accuracyScore, 100); assert.equal(malformed.accuracyScore, 0);
  });

  await test('Missing Metrics: Cost efficiency is null when tokens unmeasured; re-normalizes without penalty', async () => {
    const execWithoutTokens: AgentExecution = {
      ...sampleCompletedExecution,
      id: 'exec-no-tokens-002',
      inputTokens: null,
      outputTokens: null,
    };

    const evaluation = engine.evaluateExecution(sampleTask, execWithoutTokens);

    assert.strictEqual(evaluation.costEfficiencyScore, null);
    assert((evaluation.overallScore ?? 0) > 80, 'Score must not drop to zero due to missing token measurement');
    assert.strictEqual(evaluation.breakdown.reNormalizedWeights.costEfficiency, 0);
    assert(evaluation.breakdown.reNormalizedWeights.accuracy > 0.40, 'Remaining weights must dynamically scale');
  });

  await test('Failure Handling: Failed execution receives strictly 0 overall score', async () => {
    const failedExec: AgentExecution = {
      ...sampleCompletedExecution,
      id: 'exec-failed-003',
      status: 'FAILED',
      errorMessage: 'HTTP error 500: Server crashed',
      rawOutput: null,
    };

    const evaluation = engine.evaluateExecution(sampleTask, failedExec);

    assert.strictEqual(evaluation.overallScore, 0);
    assert.strictEqual(evaluation.accuracyScore, 0);
    assert.strictEqual(evaluation.completionScore, 0);
    assert.strictEqual(evaluation.reliabilityScore, 0);
    assert.strictEqual(evaluation.speedScore, 0);
    assert.strictEqual(evaluation.evaluationStatus, 'FAILED');
    assert.strictEqual(evaluation.passedTestCount, 0);
  });

  await test('Timeout Handling: Timed out execution receives strictly 0 overall score and 0 accuracy', async () => {
    const timeoutExec: AgentExecution = {
      ...sampleCompletedExecution,
      id: 'exec-timeout-004',
      status: 'TIMED_OUT',
      errorMessage: 'Execution timed out after 30000ms',
      rawOutput: null,
    };

    const evaluation = engine.evaluateExecution(sampleTask, timeoutExec);

    assert.strictEqual(evaluation.overallScore, 0);
    assert.strictEqual(evaluation.accuracyScore, 0);
    assert.strictEqual(evaluation.completionScore, 0);
    assert.strictEqual(evaluation.speedScore, 0);
  });

  // ---------------------------------------------------------
  // 3. Database Persistence & Deduplication
  // ---------------------------------------------------------
  await test('Persistence: Saves and retrieves evaluations from disk', async () => {
    const evalA = engine.evaluateExecution(sampleTask, sampleCompletedExecution);
    evaluationDb.saveEvaluations([evalA]);

    const retrieved = evaluationDb.listForRun(sampleCompletedExecution.runId);
    assert.strictEqual(retrieved.length, 1);
    assert.strictEqual(retrieved[0].id, evalA.id);
    assert.strictEqual(retrieved[0].overallScore, evalA.overallScore);

    // Clean up
    evaluationDb.deleteForRun(sampleCompletedExecution.runId);
  });

  console.log('\n------------------------------------------------------');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage5Tests().catch(err => {
  console.error('Stage 5 test runner fatal error:', err);
  process.exit(1);
});
