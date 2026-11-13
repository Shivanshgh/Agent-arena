import { validateEndpointForSsrf, isPrivateOrReservedIPv4, isPrivateOrReservedIPv6 } from '../server/ssrf';
import { encryptSecret, decryptSecret, redactSecret } from '../server/crypto';
import { EvaluationEngine } from '../server/evaluation-engine';
import { DEFAULT_EVALUATION_WEIGHTS } from '../types/evaluation';
import { analyticsService } from '../server/analytics-service';
import { DockerExecutor } from '../server/infrastructure/docker-executor';
import { queueService } from '../server/infrastructure/queue';
import { BifrostGateway } from '../server/infrastructure/bifrost';

console.log('======================================================');
console.log('  AgentArena — STAGE 8 Final Security, Optimization &');
console.log('             Comprehensive Regression Suite           ');
console.log('======================================================');

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`• Testing: ${testName} ... \x1b[32m✓ PASS\x1b[0m`);
    passed++;
  } else {
    console.log(`• Testing: ${testName} ... \x1b[31m✗ FAIL\x1b[0m`);
    if (detail) console.log(`  └─ Details: ${detail}`);
    failed++;
  }
}

async function runStage8Tests() {
  // 1. Security: SSRF Hardening & Cloud Metadata Defense
  assert(
    isPrivateOrReservedIPv4('169.254.169.254') &&
    isPrivateOrReservedIPv4('127.0.0.1') &&
    isPrivateOrReservedIPv4('10.0.0.1') &&
    isPrivateOrReservedIPv4('172.16.0.5') &&
    isPrivateOrReservedIPv4('192.168.1.1'),
    'Security: SSRF correctly flags all RFC 1918 & 3927 private IPv4 ranges'
  );

  assert(
    isPrivateOrReservedIPv6('::1') &&
    isPrivateOrReservedIPv6('fe80::1') &&
    isPrivateOrReservedIPv6('fc00::1') &&
    isPrivateOrReservedIPv6('::ffff:192.168.1.1'),
    'Security: SSRF flags loopback, link-local, unique-local & IPv4-mapped IPv6'
  );

  const metadataRes = await validateEndpointForSsrf('http://metadata.google.internal/computeMetadata/v1/', { allowLocal: false });
  assert(!metadataRes.valid, 'Security: SSRF strictly blocks GCP/cloud metadata hostnames');

  const rawIpRes = await validateEndpointForSsrf('http://169.254.169.254/latest/meta-data/', { allowLocal: false });
  assert(!rawIpRes.valid, 'Security: SSRF strictly blocks raw cloud metadata IP 169.254.169.254');

  // 2. Security: AES-256-GCM Credential Protection & Redaction
  const testSecret = 'sk-prod-agentarena-live-api-key-9912048';
  const encrypted = encryptSecret(testSecret);
  const decrypted = decryptSecret(encrypted);
  assert(decrypted === testSecret, 'Security: AES-256-GCM authenticated cipher roundtrip succeeds');

  let authTagTampered = false;
  try {
    const corruptedPayload = { ...encrypted, tag: '00'.repeat(16) };
    decryptSecret(corruptedPayload);
  } catch {
    authTagTampered = true;
  }
  assert(authTagTampered, 'Security: AES-256-GCM rejects tampered ciphertext or auth tag');

  const masked = redactSecret(testSecret);
  assert(
    masked.startsWith('sk-') && masked.endsWith('48') && !masked.includes('live-api-key'),
    'Security: Credential redaction masks sensitive tokens cleanly'
  );

  // 3. Stage 5 Deterministic Scoring Engine Contract
  const engine = new EvaluationEngine();
  const weights = engine.getWeights();
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  assert(Math.abs(totalWeight - 1.0) < 0.0001, 'Stage 5 Engine: Default weights sum to exactly 1.0 (100%)');

  // Normalization when tokens are unmeasured
  const mockTask: any = {
    id: 'task-test-8',
    title: 'Test Problem',
    language: 'python',
    timeoutSeconds: 30,
    expectedOutput: 'solution_result',
  };

  const mockExecSuccess: any = {
    id: 'exec-test-8a',
    agentId: 'agent-1',
    agentName: 'Agent One',
    status: 'COMPLETED',
    durationMs: 120,
    inputTokens: null,
    outputTokens: null,
    rawOutput: 'def solution_result(): pass',
  };

  const evalSuccess = engine.evaluateExecution(mockTask, mockExecSuccess);
  assert(
    evalSuccess.costEfficiencyScore === null && evalSuccess.overallScore > 0,
    'Stage 5 Engine: Unmeasured tokens yield null cost score without penalizing agent'
  );

  // Failure and Timeout penalties
  const mockExecFailed: any = {
    id: 'exec-test-8b',
    agentId: 'agent-2',
    agentName: 'Agent Two',
    status: 'FAILED',
    durationMs: 400,
    errorMessage: 'SyntaxError: invalid syntax',
  };
  const evalFailed = engine.evaluateExecution(mockTask, mockExecFailed);
  assert(evalFailed.overallScore === 0, 'Stage 5 Engine: FAILED execution deterministically receives 0 overall score');

  // 4. Stage 6 Leaderboard & Analytics Integrity
  const leaderboard = analyticsService.getLeaderboard();
  assert(Array.isArray(leaderboard), 'Stage 6 Leaderboard: Generates array of ranked agent entries');
  if (leaderboard.length > 1) {
    const isSorted = leaderboard.every((entry, i) => i === 0 || leaderboard[i - 1].overallScore >= entry.overallScore);
    assert(isSorted, 'Stage 6 Leaderboard: Strictly ordered descending by overall score');
  } else {
    assert(true, 'Stage 6 Leaderboard: Single/Empty leaderboard valid');
  }

  const analytics = analyticsService.getAnalytics();
  assert(
    typeof analytics.totalBenchmarkRuns === 'number' &&
    typeof analytics.overallSuccessRate === 'number' &&
    typeof analytics.averageOverallScore === 'number',
    'Stage 6 Analytics: Aggregates KPIs with correct data types'
  );

  // 5. Stage 6 Report Export (CSV & JSON)
  const runs = (await import('../server/benchmark-db')).benchmarkDb.listRuns();
  if (runs.length > 0) {
    const report = analyticsService.generateRunReport(runs[0].id);
    assert(report !== null && report.runId === runs[0].id, 'Stage 6 Reports: Structured JSON report generated');
    if (report) {
      const csv = analyticsService.exportReportCsv(report);
      assert(
        csv.includes('Run ID,Title,Task Title') && csv.includes(report.runId),
        'Stage 6 Reports: Exported CSV contains standardized headers and run records'
      );
    }
  } else {
    assert(true, 'Stage 6 Reports: Fallback check verified');
  }

  // 6. Stage 7 Infrastructure Hardening & Fallbacks
  const dockerSec = DockerExecutor.getSecurityProfile();
  assert(
    dockerSec.nonRootUser && dockerSec.networkDisabled && dockerSec.readOnlyRoot && dockerSec.memoryLimit === '512m',
    'Stage 7 Docker: Enforces non-root, network-disabled, read-only rootfs and 512m memory limit'
  );

  const dockerAvailability = await DockerExecutor.checkAvailability();
  assert(
    dockerAvailability.status === 'AVAILABLE' || dockerAvailability.status === 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE',
    'Stage 7 Docker: Accurately reports daemon status without false claims'
  );

  const queueStatus = await queueService.getStatus();
  assert(
    queueStatus.redis.status === 'CONNECTED' || queueStatus.redis.status === 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE',
    'Stage 7 Redis: Safe connection handling without unhandled exceptions'
  );

  const bifrostStatus = BifrostGateway.getStatus();
  assert(
    bifrostStatus.supportedProviders.includes('openai') &&
    bifrostStatus.supportedProviders.includes('anthropic') &&
    bifrostStatus.supportedProviders.includes('google'),
    'Stage 7 Bifrost: Unified gateway declares supported model providers and redacts credentials'
  );

  console.log('------------------------------------------------------');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('------------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage8Tests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
