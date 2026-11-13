import { z } from 'zod';

export type IntegrationType = 'HTTP' | 'DOCKER' | 'SDK';
export type ConnectionStatus = 'CONNECTED' | 'UNREACHABLE' | 'ERROR' | 'UNTESTED';
export type AuthType = 'NONE' | 'BEARER' | 'API_KEY' | 'CUSTOM_HEADER';
export type TaskExecutionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timed_out';

// ==========================================
// Standardized AgentArena HTTP Protocol v1.0
// ==========================================

export const StandardizedTaskSchema = z.object({
  taskId: z.string().min(1, 'taskId is required'),
  title: z.string().min(1, 'title is required'),
  description: z.string().min(1, 'description is required'),
  language: z.string().min(1, 'language is required'),
  input: z.record(z.string(), z.any()).default({}),
});
export type StandardizedTask = z.infer<typeof StandardizedTaskSchema>;

export const StandardizedConstraintsSchema = z.object({
  timeoutSeconds: z.number().int().positive().max(600).default(120),
  maxOutputSizeBytes: z.number().int().positive().max(10_000_000).default(100_000),
});
export type StandardizedConstraints = z.infer<typeof StandardizedConstraintsSchema>;

export const StandardizedAgentRequestSchema = z.object({
  protocolVersion: z.literal('1.0'),
  requestId: z.string().min(1),
  task: StandardizedTaskSchema,
  constraints: StandardizedConstraintsSchema.default({
    timeoutSeconds: 120,
    maxOutputSizeBytes: 100_000,
  }),
});
export type StandardizedAgentRequest = z.infer<typeof StandardizedAgentRequestSchema>;

export const StandardizedMetricsSchema = z.object({
  durationMs: z.number().min(0),
  // Missing measurements must remain null, never zero
  inputTokens: z.number().int().positive().nullable().default(null),
  outputTokens: z.number().int().positive().nullable().default(null),
});
export type StandardizedMetrics = z.infer<typeof StandardizedMetricsSchema>;

export const StandardizedAgentResponseSchema = z.object({
  protocolVersion: z.literal('1.0'),
  requestId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'timed_out']),
  result: z
    .object({
      content: z.string().default(''),
      diff: z.string().optional(),
      files: z.record(z.string(), z.string()).optional(),
    })
    .nullable()
    .default(null),
  metrics: StandardizedMetricsSchema.default({
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
  }),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.any().optional(),
    })
    .nullable()
    .default(null),
  metadata: z.record(z.string(), z.any()).default({}),
});
export type StandardizedAgentResponse = z.infer<typeof StandardizedAgentResponseSchema>;

// ==========================================
// Standardized Health Check Protocol
// ==========================================

export const AgentHealthResponseSchema = z.object({
  status: z.enum(['healthy', 'ok', 'degraded']),
  version: z.string().optional(),
  protocolVersion: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  uptimeSeconds: z.number().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});
export type AgentHealthResponse = z.infer<typeof AgentHealthResponseSchema>;

// ==========================================
// Agent Registration & Entity Schemas
// ==========================================

export const RegisterAgentSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(64),
  description: z.string().trim().max(500).default(''),
  version: z.string().trim().regex(/^v?\d+\.\d+(\.\d+)?(-[\w.]+)?$/, 'Invalid semver format (e.g. 1.0.0)').default('1.0.0'),
  integrationType: z.enum(['HTTP', 'DOCKER', 'SDK']).default('HTTP'),
  endpoint: z.string().trim().url('Must be a valid URL'),
  supportedLanguages: z.array(z.string()).min(1, 'Specify at least one supported language'),
  supportedCapabilities: z.array(z.string()).default([]),
  
  // Auth configuration
  authType: z.enum(['NONE', 'BEARER', 'API_KEY', 'CUSTOM_HEADER']).default('NONE'),
  authHeaderName: z.string().trim().optional(),
  authSecret: z.string().trim().optional(), // In-transit only, encrypted before storage
  
  metadata: z.record(z.string(), z.any()).default({}),
});

export type RegisterAgentInput = z.input<typeof RegisterAgentSchema>;

export const UpdateAgentSchema = RegisterAgentSchema.partial();
export type UpdateAgentInput = z.input<typeof UpdateAgentSchema>;

// Sanitized Agent object (safe for public/frontend consumption)
export interface Agent {
  id: string;
  name: string;
  description: string;
  version: string;
  integrationType: IntegrationType;
  endpoint: string;
  supportedLanguages: string[];
  supportedCapabilities: string[];
  
  authType: AuthType;
  authHeaderName?: string;
  hasAuthSecret: boolean; // Never expose the actual secret!
  
  connectionStatus: ConnectionStatus;
  lastSuccessfulConnection: string | null;
  lastCheckedAt: string | null;
  lastErrorMessage: string | null;
  
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionTestResult {
  success: boolean;
  statusCode?: number;
  latencyMs?: number;
  resolvedIp?: string;
  healthPayload?: AgentHealthResponse | null;
  errorMessage?: string;
  testedAt: string;
}

export interface TaskExecutionResult {
  success: boolean;
  request: StandardizedAgentRequest;
  response: StandardizedAgentResponse | null;
  durationMs: number;
  errorMessage?: string;
}
