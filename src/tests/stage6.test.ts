import assert from 'assert';
import { analyticsService } from '../server/analytics-service';
import { benchmarkDb } from '../server/benchmark-db';
import { evaluationDb } from '../server/evaluation-db';
import { ExecutionEvaluation } from '../types/evaluation';
import { BenchmarkRun } from '../types/benchmark';

async function runStage6Tests() {
  console.log('\n======================================================');
  console.log('  AgentArena — STAGE 6 Leaderboard & Analytics Suite');
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
  // Test Fixture Setup: Synthetic Runs & Evaluations
  // ---------------------------------------------------------
  const fixtureRunId = `run-fixture-stage6-${Date.now()}`;
  const now = new Date().toISOString();

  const fixtureRun: BenchmarkRun = {
    id: fixtureRunId,
    title: 'Stage 6 Leaderboard Benchmark Fixture',
    taskId: 'task-two-sum',
    taskTitle: 'Two Sum Problem',
    taskLanguage: 'typescript',
    taskDescription: 'Solve two sum',
    taskDifficulty: 'EASY',
    agentIds: ['agent-mock-builtin', 'agent-fixture-b'],
    status: 'COMPLETED',
    startedAt: now,
    completedAt: now,
    durationMs: 120,
    executions: [
      {
        id: `exec-s6-1`,
        runId: fixtureRunId,
        agentId: 'agent-mock-builtin',
        agentName: 'AgentArena Reference Mock Agent',
        agentEndpoint: 'http://localhost:3000/api/mock-agent',
        requestId: 'req-s6-1',
        status: 'COMPLETED',
        startedAt: now,
        completedAt: now,
        durationMs: 90,
        inputTokens: 100,
        outputTokens: 150,
        errorMessage: null,
        rawOutput: 'function twoSum() { return [0, 1]; }',
        metadata: {},
      },
      {
        id: `exec-s6-2`,
        runId: fixtureRunId,
        agentId: 'agent-fixture-b',
        agentName: 'Challenger Agent Beta',
        agentEndpoint: 'http://localhost:3000/api/mock-agent-b',
        requestId: 'req-s6-2',
        status: 'COMPLETED',
        startedAt: now,
        completedAt: now,
        durationMs: 150,
        inputTokens: null,
        outputTokens: null,
        errorMessage: null,
        rawOutput: 'function twoSum() { return [0, 1]; }',
        metadata: {},
      },
    ],
    createdAt: now,
  };

  const fixtureEvals: ExecutionEvaluation[] = [
    {
      id: `eval-s6-1`,
      runId: fixtureRunId,
      executionId: `exec-s6-1`,
      agentId: 'agent-mock-builtin',
      agentName: 'AgentArena Reference Mock Agent',
      taskId: 'task-two-sum',
      accuracyScore: 90,
      completionScore: 100,
      reliabilityScore: 100,
      speedScore: 95,
      costEfficiencyScore: 90,
      overallScore: 94,
      passedTestCount: 4,
      failedTestCount: 0,
      totalTestCount: 4,
      evaluationStatus: 'EVALUATED',
      evaluationVersion: '1.0.0',
      breakdown: {
        accuracyDetails: 'All tests passed',
        completionDetails: 'Completed',
        reliabilityDetails: 'Reliable',
        speedDetails: 'Fast',
        costDetails: 'Low cost',
        testCaseResults: [],
        reNormalizedWeights: { accuracy: 0.4, completion: 0.25, reliability: 0.15, speed: 0.1, costEfficiency: 0.1 },
      },
      evaluatedAt: now,
    },
    {
      id: `eval-s6-2`,
      runId: fixtureRunId,
      executionId: `exec-s6-2`,
      agentId: 'agent-fixture-b',
      agentName: 'Challenger Agent Beta',
      taskId: 'task-two-sum',
      accuracyScore: 80,
      completionScore: 90,
      reliabilityScore: 100,
      speedScore: 85,
      costEfficiencyScore: null,
      overallScore: 86,
      passedTestCount: 3,
      failedTestCount: 1,
      totalTestCount: 4,
      evaluationStatus: 'EVALUATED',
      evaluationVersion: '1.0.0',
      breakdown: {
        accuracyDetails: '3/4 passed',
        completionDetails: 'Completed',
        reliabilityDetails: 'Reliable',
        speedDetails: 'Average',
        costDetails: 'Unmeasured',
        testCaseResults: [],
        reNormalizedWeights: { accuracy: 0.444, completion: 0.278, reliability: 0.167, speed: 0.111, costEfficiency: 0 },
      },
      evaluatedAt: now,
    },
  ];

  benchmarkDb.createRun(fixtureRun);
  evaluationDb.saveEvaluations(fixtureEvals);

  // ---------------------------------------------------------
  // 1. Leaderboard Ranking & Filtering
  // ---------------------------------------------------------
  await test('Leaderboard: Computes correct ranks and orders agents by overall score', async () => {
    const leaderboard = analyticsService.getLeaderboard();
    assert(leaderboard.length >= 2, 'Leaderboard must contain at least 2 evaluated agents');

    // Rank 1 should have higher or equal overall score than Rank 2
    assert(leaderboard[0].overallScore >= leaderboard[1].overallScore);
    assert.strictEqual(leaderboard[0].rank, 1);
    assert.strictEqual(leaderboard[1].rank, 2);
  });

  await test('Leaderboard: Filters rankings by programming language correctly', async () => {
    const tsLeaderboard = analyticsService.getLeaderboard({ language: 'typescript' });
    assert(tsLeaderboard.length >= 1, 'Should find entries for typescript');

    const javaLeaderboard = analyticsService.getLeaderboard({ language: 'java' });
    // Java has no runs evaluated in this fixture
    assert(javaLeaderboard.length === 0);
  });

  await test('Leaderboard: Distinguishes unmeasured tokens (null) without penalizing success rate', async () => {
    const leaderboard = analyticsService.getLeaderboard();
    const betaEntry = leaderboard.find(e => e.agentId === 'agent-fixture-b');

    assert(betaEntry !== undefined);
    assert.strictEqual(betaEntry?.successRate, 100);
    assert.strictEqual(betaEntry?.costEfficiencyScore, null);
  });

  // ---------------------------------------------------------
  // 2. Analytics Dashboard Calculations
  // ---------------------------------------------------------
  await test('Analytics: Aggregates system metrics, category, and language breakdowns', async () => {
    const analytics = analyticsService.getAnalytics();

    assert(analytics.totalBenchmarkRuns >= 1);
    assert(analytics.totalEvaluatedExecutions >= 2);
    assert(analytics.overallSuccessRate >= 0 && analytics.overallSuccessRate <= 100);
    assert(analytics.averageOverallScore > 0);
    assert('Arrays & Hash Maps' in analytics.categoryBreakdown || Object.keys(analytics.categoryBreakdown).length > 0);
    assert('typescript' in analytics.languageBreakdown);
  });

  // ---------------------------------------------------------
  // 3. Benchmark Report Exporting (CSV and JSON)
  // ---------------------------------------------------------
  await test('Reports: Generates complete structured JSON report for a benchmark run', async () => {
    const report = analyticsService.generateRunReport(fixtureRunId);
    assert(report !== null);
    assert.strictEqual(report?.runId, fixtureRunId);
    assert.strictEqual(report?.agentResults.length, 2);
    assert.strictEqual(report?.agentResults[0].status, 'COMPLETED');
  });

  await test('Reports: Exports clean, parseable CSV report with correct column headers', async () => {
    const report = analyticsService.generateRunReport(fixtureRunId);
    assert(report !== null);

    const csv = analyticsService.exportReportCsv(report!);
    assert(csv.includes('Run ID,Title,Task Title,Language,Difficulty,Status'));
    assert(csv.includes(fixtureRunId));
    assert(csv.includes('AgentArena Reference Mock Agent'));
  });

  // Cleanup fixture
  evaluationDb.deleteForRun(fixtureRunId);

  console.log('\n------------------------------------------------------');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage6Tests().catch(err => {
  console.error('Stage 6 test runner fatal error:', err);
  process.exit(1);
});
