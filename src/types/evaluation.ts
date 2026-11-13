import { z } from 'zod';

export interface EvaluationWeights {
  accuracy: number;       // default 0.40 (40%)
  completion: number;     // default 0.25 (25%)
  reliability: number;    // default 0.15 (15%)
  speed: number;          // default 0.10 (10%)
  costEfficiency: number; // default 0.10 (10%)
}

export const DEFAULT_EVALUATION_WEIGHTS: EvaluationWeights = {
  accuracy: 0.40,
  completion: 0.25,
  reliability: 0.15,
  speed: 0.10,
  costEfficiency: 0.10,
};

export interface TestCaseResult {
  name: string;
  passed: boolean;
  message: string;
  expected?: string;
  actual?: string;
}

export interface EvaluationBreakdown {
  accuracyDetails: string;
  completionDetails: string;
  reliabilityDetails: string;
  speedDetails: string;
  costDetails: string;
  testCaseResults: TestCaseResult[];
  reNormalizedWeights: {
    accuracy: number;
    completion: number;
    reliability: number;
    speed: number;
    costEfficiency: number;
  };
}

export interface ExecutionEvaluation {
  id: string;
  runId: string;
  executionId: string;
  agentId: string;
  agentName: string;
  taskId: string;
  accuracyScore: number;         // 0 - 100
  completionScore: number;       // 0 - 100
  reliabilityScore: number;      // 0 - 100
  speedScore: number;            // 0 - 100
  costEfficiencyScore: number | null; // 0 - 100 or null if tokens unmeasured
  overallScore: number;          // 0 - 100
  passedTestCount: number;
  failedTestCount: number;
  totalTestCount: number;
  evaluationStatus: 'EVALUATED' | 'FAILED' | 'SKIPPED';
  evaluationVersion: string;     // e.g. "1.0.0"
  breakdown: EvaluationBreakdown;
  evaluatedAt: string;
}

export const EvaluateRunSchema = z.object({
  recalculate: z.boolean().default(false),
  weights: z
    .object({
      accuracy: z.number().min(0).max(1),
      completion: z.number().min(0).max(1),
      reliability: z.number().min(0).max(1),
      speed: z.number().min(0).max(1),
      costEfficiency: z.number().min(0).max(1),
    })
    .optional(),
});
export type EvaluateRunInput = z.infer<typeof EvaluateRunSchema>;
