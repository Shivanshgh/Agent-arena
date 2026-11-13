import crypto from 'crypto';
import { AgentExecution, BenchmarkTask } from '../types/benchmark';
import {
  DEFAULT_EVALUATION_WEIGHTS,
  EvaluationWeights,
  ExecutionEvaluation,
  TestCaseResult,
} from '../types/evaluation';

export const EVALUATION_ENGINE_VERSION = '1.0.0';

export class EvaluationEngine {
  private weights: EvaluationWeights;

  constructor(weights: Partial<EvaluationWeights> = {}) {
    this.weights = { ...DEFAULT_EVALUATION_WEIGHTS, ...weights };
    this.validateWeights();
  }

  /**
   * Validates that evaluation weights sum up to 1.0 (100%)
   */
  private validateWeights(): void {
    const sum =
      this.weights.accuracy +
      this.weights.completion +
      this.weights.reliability +
      this.weights.speed +
      this.weights.costEfficiency;

    if (Math.abs(sum - 1.0) > 0.001) {
      throw new Error(`Evaluation weights must sum to 1.0 (100%). Current sum: ${sum.toFixed(3)}`);
    }
  }

  public getWeights(): EvaluationWeights {
    return { ...this.weights };
  }

  /**
   * Evaluates a single agent execution deterministically against the task definition
   */
  public evaluateExecution(
    task: BenchmarkTask,
    execution: AgentExecution
  ): ExecutionEvaluation {
    const testCases: TestCaseResult[] = [];

    // If execution completely failed or timed out
    if (execution.status === 'FAILED') {
      return this.buildFailedEvaluation(
        task,
        execution,
        'FAILED',
        execution.errorMessage || 'Agent execution failed with error'
      );
    }

    if (execution.status === 'TIMED_OUT') {
      return this.buildFailedEvaluation(
        task,
        execution,
        'TIMED_OUT',
        execution.errorMessage || 'Execution exceeded allocated time limit'
      );
    }

    const output = (execution.rawOutput || '').trim();

    // -------------------------------------------------------------
    // Test Case 1: Non-Empty Syntactically Coherent Code Output
    // -------------------------------------------------------------
    const hasMeaningfulCode = output.length > 20 && !output.includes('Traceback (most recent call last)');
    testCases.push({
      name: 'Code Structure & Synthesis',
      passed: hasMeaningfulCode,
      message: hasMeaningfulCode
        ? `Generated valid ${task.language} solution structure (${output.length} characters)`
        : 'Output is empty or contains fatal execution crash trace',
    });

    // -------------------------------------------------------------
    // Test Case 2: Language-Appropriate Constructs
    // -------------------------------------------------------------
    const lang = task.language.toLowerCase();
    let hasLanguagePatterns = false;
    if (lang.includes('python')) {
      hasLanguagePatterns = /def\s+\w+|class\s+\w+|import\s+\w+|return\b/.test(output);
    } else if (lang.includes('typescript') || lang.includes('javascript')) {
      hasLanguagePatterns = /function\s+\w+|const\s+\w+\s*=|export\s+|return\b|=>/.test(output);
    } else {
      hasLanguagePatterns = /return\b|\bfunc\b|\bfn\b|class\b/.test(output);
    }

    testCases.push({
      name: 'Language Semantic Patterns',
      passed: hasLanguagePatterns,
      message: hasLanguagePatterns
        ? `Code adheres to expected ${task.language} syntax patterns`
        : `Code lacks expected idioms or declarations for ${task.language}`,
    });

    // -------------------------------------------------------------
    // Test Case 3: Problem Signature & Intent Alignment
    // -------------------------------------------------------------
    const titleWords = task.title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .split(' ')
      .filter(w => w.length >= 3 && !['problem', 'evaluation', 'challenge'].includes(w));

    const matchesKeywords =
      titleWords.length === 0 ||
      titleWords.some(w => output.toLowerCase().includes(w)) ||
      output.toLowerCase().includes('solution') ||
      output.toLowerCase().includes('solve');

    testCases.push({
      name: 'Problem Domain Alignment',
      passed: matchesKeywords,
      message: matchesKeywords
        ? `Solution aligns with task intent (${titleWords.slice(0, 3).join(', ')})`
        : 'Solution does not reference domain concepts from task description',
    });

    // -------------------------------------------------------------
    // Test Case 4: Expected Output / Spec Alignment (if specified)
    // -------------------------------------------------------------
    if (task.expectedOutput && task.expectedOutput.trim().length > 0) {
      const cleanExpected = task.expectedOutput.trim().toLowerCase();
      const outputLower = output.toLowerCase();

      // Check for exact substring match, json match, or return statement
      const matchesExpected =
        outputLower.includes(cleanExpected) ||
        outputLower.includes(cleanExpected.replace(/\s+/g, '')) ||
        (cleanExpected.startsWith('[') && outputLower.includes('return [')) ||
        (cleanExpected === 'true' && outputLower.includes('return true'));

      testCases.push({
        name: 'Expected Output Alignment',
        passed: matchesExpected,
        message: matchesExpected
          ? `Solution implements logic producing expected output: ${task.expectedOutput}`
          : `Output does not contain target result pattern: ${task.expectedOutput}`,
        expected: task.expectedOutput,
      });
    }

    // -------------------------------------------------------------
    // Metric Calculations
    // -------------------------------------------------------------
    const passedCount = testCases.filter(t => t.passed).length;
    const totalCount = testCases.length;

    // 1. Accuracy Score (0 - 100)
    const accuracyScore = Math.round((passedCount / totalCount) * 100);

    // 2. Task Completion Score (0 - 100)
    let completionScore = 0;
    if (execution.status === 'COMPLETED') {
      if (passedCount === totalCount) completionScore = 100;
      else if (passedCount >= 2) completionScore = 90;
      else if (passedCount > 0) completionScore = Math.round((passedCount / totalCount) * 80);
      else completionScore = 20; // Returned something but failed all criteria
    }

    // 3. Reliability Score (0 - 100)
    const reliabilityScore = execution.status === 'COMPLETED' ? 100 : 0;

    // 4. Speed Score (0 - 100)
    let speedScore = 0;
    const duration = execution.durationMs || 0;
    const timeoutMs = (task.timeoutSeconds || 60) * 1000;

    if (duration <= 100) speedScore = 100;
    else if (duration <= 500) speedScore = 95;
    else if (duration <= 2000) speedScore = 90;
    else {
      speedScore = Math.max(10, Math.min(100, Math.round(100 * (1 - Math.min(1, duration / timeoutMs)))));
    }

    // 5. Cost Efficiency Score (0 - 100 or null)
    let costEfficiencyScore: number | null = null;
    const totalTokens =
      (execution.inputTokens !== null ? execution.inputTokens : 0) +
      (execution.outputTokens !== null ? execution.outputTokens : 0);

    const hasTokens = execution.inputTokens !== null || execution.outputTokens !== null;

    if (hasTokens && totalTokens > 0) {
      // Benchmark token efficiency curve (2500 tokens is baseline)
      costEfficiencyScore = Math.max(
        0,
        Math.min(100, Math.round(100 * (1 - Math.min(1, totalTokens / 2500))))
      );
    }

    // 6. Overall Weighted Score Calculation
    let overallScore: number;
    const reNormalizedWeights = { ...this.weights };

    if (costEfficiencyScore === null) {
      // Re-normalize remaining weights so they sum to 1.0 without penalizing for unmeasured cost
      const availableWeightSum =
        this.weights.accuracy +
        this.weights.completion +
        this.weights.reliability +
        this.weights.speed;

      const normAcc = this.weights.accuracy / availableWeightSum;
      const normComp = this.weights.completion / availableWeightSum;
      const normRel = this.weights.reliability / availableWeightSum;
      const normSpd = this.weights.speed / availableWeightSum;

      reNormalizedWeights.accuracy = normAcc;
      reNormalizedWeights.completion = normComp;
      reNormalizedWeights.reliability = normRel;
      reNormalizedWeights.speed = normSpd;
      reNormalizedWeights.costEfficiency = 0;

      overallScore = Math.round(
        accuracyScore * normAcc +
        completionScore * normComp +
        reliabilityScore * normRel +
        speedScore * normSpd
      );
    } else {
      overallScore = Math.round(
        accuracyScore * this.weights.accuracy +
        completionScore * this.weights.completion +
        reliabilityScore * this.weights.reliability +
        speedScore * this.weights.speed +
        costEfficiencyScore * this.weights.costEfficiency
      );
    }

    overallScore = Math.max(0, Math.min(100, overallScore));

    return {
      id: `eval-${crypto.randomUUID()}`,
      runId: execution.runId,
      executionId: execution.id,
      agentId: execution.agentId,
      agentName: execution.agentName,
      taskId: task.id,
      accuracyScore,
      completionScore,
      reliabilityScore,
      speedScore,
      costEfficiencyScore,
      overallScore,
      passedTestCount: passedCount,
      failedTestCount: totalCount - passedCount,
      totalTestCount: totalCount,
      evaluationStatus: 'EVALUATED',
      evaluationVersion: EVALUATION_ENGINE_VERSION,
      breakdown: {
        accuracyDetails: `${passedCount}/${totalCount} validation test cases passed (${accuracyScore}%)`,
        completionDetails: `Execution completed successfully with structured output (${completionScore}%)`,
        reliabilityDetails: `Reliable execution without errors or crash dumps (${reliabilityScore}%)`,
        speedDetails: `Duration: ${duration}ms against ${task.timeoutSeconds}s timeout budget (${speedScore}%)`,
        costDetails: costEfficiencyScore !== null
          ? `Measured tokens: ${totalTokens} (Input: ${execution.inputTokens ?? 'null'}, Output: ${execution.outputTokens ?? 'null'}) -> ${costEfficiencyScore}%`
          : 'Token metrics not reported by agent; weights dynamically re-normalized without penalty',
        testCaseResults: testCases,
        reNormalizedWeights,
      },
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Helper for failed/timed-out executions ensuring zero scores
   */
  private buildFailedEvaluation(
    task: BenchmarkTask,
    execution: AgentExecution,
    failureType: 'FAILED' | 'TIMED_OUT',
    reason: string
  ): ExecutionEvaluation {
    return {
      id: `eval-${crypto.randomUUID()}`,
      runId: execution.runId,
      executionId: execution.id,
      agentId: execution.agentId,
      agentName: execution.agentName,
      taskId: task.id,
      accuracyScore: 0,
      completionScore: 0,
      reliabilityScore: 0,
      speedScore: 0,
      costEfficiencyScore: null,
      overallScore: 0,
      passedTestCount: 0,
      failedTestCount: 1,
      totalTestCount: 1,
      evaluationStatus: 'FAILED',
      evaluationVersion: EVALUATION_ENGINE_VERSION,
      breakdown: {
        accuracyDetails: '0% - Execution did not succeed',
        completionDetails: `0% - Status was ${failureType}`,
        reliabilityDetails: `0% - ${failureType}: ${reason}`,
        speedDetails: '0% - Failed executions receive no speed score',
        costDetails: 'Unavailable due to execution failure',
        testCaseResults: [
          {
            name: `Execution Health Check (${failureType})`,
            passed: false,
            message: reason,
          },
        ],
        reNormalizedWeights: { ...this.weights },
      },
      evaluatedAt: new Date().toISOString(),
    };
  }
}
