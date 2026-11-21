import { z } from 'zod';

export type TaskDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIALLY_FAILED' | 'FAILED';
export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT';
export type EvaluationStrategy = 'CODE_UNVERIFIED' | 'EXACT_MATCH' | 'JSON_EXACT' | 'HEURISTIC_TEXT';

// ==========================================
// Benchmark Task Schemas
// ==========================================

export const BenchmarkTaskSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(100),
  description: z.string().trim().min(10, 'Description must be at least 10 characters'),
  language: z.string().trim().min(1, 'Language is required'),
  category: z.string().trim().default('Algorithms'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
  inputData: z.record(z.string(), z.any()).default({}),
  expectedOutput: z.string().trim().optional(),
  evaluationStrategy: z.enum(['CODE_UNVERIFIED', 'EXACT_MATCH', 'JSON_EXACT', 'HEURISTIC_TEXT']).default('CODE_UNVERIFIED'),
  timeoutSeconds: z.number().int().min(5).max(300).default(60),
  maxOutputSizeBytes: z.number().int().min(1000).max(10_000_000).default(100_000),
  isActive: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BenchmarkTask = z.infer<typeof BenchmarkTaskSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(100),
  description: z.string().trim().min(10, 'Description must be at least 10 characters'),
  language: z.string().trim().min(1, 'Language is required'),
  category: z.string().trim().default('Algorithms'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
  inputData: z.record(z.string(), z.any()).default({}),
  expectedOutput: z.string().trim().optional(),
  evaluationStrategy: z.enum(['CODE_UNVERIFIED', 'EXACT_MATCH', 'JSON_EXACT', 'HEURISTIC_TEXT']).default('CODE_UNVERIFIED'),
  timeoutSeconds: z.number().int().min(5).max(300).default(60),
  maxOutputSizeBytes: z.number().int().min(1000).max(10_000_000).default(100_000),
  isActive: z.boolean().default(true),
});
export type CreateTaskInput = z.input<typeof CreateTaskSchema>;
export const UpdateTaskSchema = CreateTaskSchema.partial();
export type UpdateTaskInput = z.input<typeof UpdateTaskSchema>;

// ==========================================
// Benchmark Run & Execution Schemas
// ==========================================

export interface AgentExecution {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  agentEndpoint: string;
  requestId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
  rawOutput: string | null;
  files?: Record<string, string>;
  metadata: Record<string, any>;
}

export interface ModelBenchmarkExecution {
  id: string;
  runId: string;
  connectionId: string | null;
  provider: 'GEMINI' | 'OPENAI' | 'ANTHROPIC' | 'DEEPSEEK';
  modelId: string;
  requestId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
  rawOutput: string | null;
  evaluation?: {
    accuracyScore: number | null; completionScore: number; reliabilityScore: number;
    speedScore: number; costEfficiencyScore: number | null; overallScore: number | null;
    evaluationStatus: string; breakdown: Record<string, unknown>;
  } | null;
}

export interface BenchmarkRun {
  id: string;
  title: string;
  taskId: string;
  taskTitle: string;
  taskLanguage: string;
  taskDescription: string;
  taskDifficulty: TaskDifficulty;
  agentIds: string[];
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  executions: AgentExecution[];
  modelExecutions?: ModelBenchmarkExecution[];
  createdAt: string;
}

export const CreateRunSchema = z.object({
  title: z.string().trim().min(2, 'Run title is required').optional(),
  taskId: z.string().min(1, 'Task selection is required'),
  agentIds: z.array(z.string()).min(2, 'Select at least two HTTP agents').optional(),
  modelConnectionIds: z.array(z.string()).min(2, 'Select at least two models').optional(),
}).refine(value => Boolean(value.agentIds) !== Boolean(value.modelConnectionIds), {
  message: 'Select either HTTP agents or models for a run.',
  path: ['executionType'],
});
export type CreateRunInput = z.input<typeof CreateRunSchema>;
