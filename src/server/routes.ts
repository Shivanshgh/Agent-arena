import express, { Request, Response } from 'express';
import { RegisterAgentSchema, UpdateAgentSchema, StandardizedAgentRequestSchema, StandardizedAgentRequest } from '../types/agent';
import { CreateTaskSchema, UpdateTaskSchema, CreateRunSchema } from '../types/benchmark';
import { EvaluateRunSchema, DEFAULT_EVALUATION_WEIGHTS } from '../types/evaluation';
import { runtimeDb } from './runtime-db';
import { BenchmarkOrchestrator } from './orchestrator';
import { EvaluationEngine } from './evaluation-engine';
import { AgentHttpAdapter } from './http-adapter';
import { validateEndpointForSsrf } from './ssrf';
import { analyticsService } from './analytics-service';
import { DockerExecutor } from './infrastructure/docker-executor';
import { queueService } from './infrastructure/queue';
import { BifrostGateway } from './infrastructure/bifrost';
import { reviewSemanticCorrectness, SemanticReviewError } from './semantic-review';
import { authRateLimit, clearSessionCookie, loginUser, registerUser, revokeSession, setSessionCookie } from './auth';
import { z } from 'zod';

export const apiRouter = express.Router();
for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
  const register = apiRouter[method].bind(apiRouter);
  (apiRouter as any)[method] = (path: string, ...handlers: any[]) => register(path, ...handlers.map((handler) =>
    (req: Request, res: Response, next: express.NextFunction) => {
      try {
        const pending = handler(req, res, next);
        if (pending && typeof pending.then === 'function') pending.catch(next);
        return pending;
      } catch (error) {
        next(error);
      }
    }
  ));
}

const AuthInputSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
}).strict();

const safeFailure = (error: unknown, productionMessage: string) =>
  process.env.NODE_ENV === 'production' ? productionMessage : error instanceof Error ? error.message : productionMessage;

apiRouter.post('/auth/register', authRateLimit(), async (req: Request, res: Response) => {
  const parsed = AuthInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Enter a valid email and a password of 12–128 characters.' });
  try {
    const user = await registerUser(parsed.data.email, parsed.data.password);
    return res.status(201).json({ success: true, data: user });
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ success: false, error: 'An account with that email already exists.' });
    return res.status(503).json({ success: false, error: 'Registration is temporarily unavailable.' });
  }
});

apiRouter.post('/auth/login', authRateLimit(), async (req: Request, res: Response) => {
  const parsed = AuthInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid email or password.' });
  try {
    const result = await loginUser(parsed.data.email, parsed.data.password);
    if (!result) return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    setSessionCookie(res, result.token);
    return res.json({ success: true, data: result.user });
  } catch {
    return res.status(503).json({ success: false, error: 'Authentication is temporarily unavailable.' });
  }
});

apiRouter.get('/auth/me', (req: Request, res: Response) => {
  if (!req.authUser) return res.status(401).json({ success: false, error: 'Authentication required.' });
  return res.json({ success: true, data: req.authUser });
});

apiRouter.post('/auth/logout', async (req: Request, res: Response) => {
  if (req.authToken) await revokeSession(req.authToken);
  clearSessionCookie(res);
  return res.json({ success: true });
});

// ==========================================
// 1. Built-in Reference Mock Agent Endpoints
// ==========================================
const mockRouter = express.Router();

mockRouter.get('/health', (req: Request, res: Response) => {
  // Support simulated failure modes via query string for testing
  const mode = req.query.mode as string;
  if (mode === '500') {
    return res.status(500).json({ error: 'Simulated internal server error' });
  }
  if (mode === 'malformed') {
    return res.send('NOT_VALID_JSON');
  }
  if (mode === 'invalid_schema') {
    return res.json({ randomKey: 12345 }); // Missing status field
  }

  // Check Bearer authorization if sent
  const authHeader = req.headers['authorization'];
  if (req.query.require_auth === 'true' && (!authHeader || !authHeader.includes('arena_test_token_9f82bc'))) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing token' });
  }

  res.json({
    status: 'healthy',
    version: '1.0.0',
    protocolVersion: '1.0',
    capabilities: ['code_generation', 'code_refactoring', 'test_generation', 'debugging'],
    uptimeSeconds: Math.round(process.uptime()),
    metadata: {
      type: 'Built-in AgentArena Reference Agent',
      environment: 'Node.js',
    },
  });
});

mockRouter.post('/execute', async (req: Request, res: Response) => {
  const mode = req.query.mode as string;

  if (mode === 'timeout') {
    // Hang connection longer than timeout
    return setTimeout(() => {
      res.json({ status: 'completed' });
    }, 15000);
  }

  if (mode === '500') {
    return res.status(500).json({ error: 'Agent execution crashed' });
  }

  if (mode === 'malformed') {
    return res.send('Corrupt Agent Response Payload');
  }

  const parsed = StandardizedAgentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      protocolVersion: '1.0',
      requestId: req.body?.requestId || 'unknown',
      status: 'failed',
      result: null,
      metrics: { durationMs: 0, inputTokens: null, outputTokens: null },
      error: {
        code: 'INVALID_REQUEST',
        message: 'Request did not match AgentArena protocol specification',
        details: parsed.error.issues,
      },
      metadata: {},
    });
  }

  const task = parsed.data.task;
  const lang = task.language.toLowerCase();

  // Generate realistic synthetic output for the challenge
  let codeOutput = '';
  if (lang.includes('python')) {
    codeOutput = `def solution(input_data):\n    # Generated by AgentArena Reference Mock Agent\n    # Task: ${task.title}\n    return input_data[::-1] if isinstance(input_data, str) else input_data\n`;
  } else if (lang.includes('typescript') || lang.includes('javascript')) {
    codeOutput = `export function solution(input: any): any {\n  // Generated by AgentArena Reference Mock Agent\n  // Task: ${task.title}\n  if (typeof input === 'string') return input.split('').reverse().join('');\n  return input;\n}\n`;
  } else {
    codeOutput = `// Agent solution for ${task.title} in ${task.language}\n// Status: Completed successfully\n`;
  }

  // Artificial short processing delay to simulate real LLM generation
  await new Promise(r => setTimeout(r, 60));

  res.json({
    protocolVersion: '1.0',
    requestId: parsed.data.requestId,
    status: 'completed',
    result: {
      content: codeOutput,
      diff: `+ ${codeOutput.replace(/\n/g, '\n+ ')}`,
      files: {
        [`solution.${lang === 'python' ? 'py' : 'ts'}`]: codeOutput,
      },
    },
    metrics: {
      durationMs: 65,
      inputTokens: 154,
      outputTokens: 210, // null if unknown, positive int if measured
    },
    error: null,
    metadata: {
      model: 'AgentArena-Mock-v1',
      evaluatedTask: task.taskId,
    },
  });
});

if (process.env.NODE_ENV !== 'production') apiRouter.use('/mock-agent', mockRouter);

// ==========================================
// 2. Arena System Health
// ==========================================
apiRouter.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    protocol: '1.0',
    timestamp: new Date().toISOString(),
    ssrfProtection: 'active',
  });
});

// ==========================================
// 3. Agent Registry REST API
// ==========================================

// List all registered agents
apiRouter.get('/agents', async (req: Request, res: Response) => {
  const agents = await runtimeDb.listAgents(req.authUser);
  res.json({
    success: true,
    data: agents,
    count: agents.length,
  });
});

// Get individual agent
apiRouter.get('/agents/:id', async (req: Request, res: Response) => {
  const agent = await runtimeDb.getAgent(req.params.id, req.authUser);
  if (!agent) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }
  res.json({ success: true, data: agent });
});

// Register new agent
apiRouter.post('/agents', async (req: Request, res: Response) => {
  const parsed = RegisterAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      issues: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  // Validate endpoint format & SSRF rules
  const ssrf = await validateEndpointForSsrf(parsed.data.endpoint);
  if (!ssrf.valid) {
    return res.status(400).json({
      success: false,
      error: `Invalid agent endpoint: ${ssrf.reason}`,
      ssrfBlocked: true,
    });
  }

  try {
    const created = await runtimeDb.createAgent(parsed.data, req.authUser);

    // If user requested immediate connection test on registration
    if (req.query.testImmediate === 'true') {
      const adapter = new AgentHttpAdapter(
        created.endpoint,
        {
          type: created.authType,
          headerName: created.authHeaderName,
          secret: parsed.data.authSecret,
        }
      );
      const testResult = await adapter.checkHealth();
      const updated = await runtimeDb.updateAgentStatus(created.id, {
        success: testResult.success,
        statusCode: testResult.statusCode,
        latencyMs: testResult.latencyMs,
        resolvedIp: testResult.resolvedIp,
        healthPayload: testResult.healthPayload,
        errorMessage: testResult.errorMessage,
        testedAt: new Date().toISOString(),
      }, req.authUser);
      return res.status(201).json({
        success: true,
        data: updated || created,
        initialConnectionTest: testResult,
      });
    }

    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    res.status(500).json({ success: false, error: safeFailure(err, 'Unable to register agent.') });
  }
});

// Update agent
apiRouter.put('/agents/:id', async (req: Request, res: Response) => {
  const existing = await runtimeDb.getAgent(req.params.id, req.authUser);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }

  const parsed = UpdateAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      issues: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  if (parsed.data.endpoint) {
    const ssrf = await validateEndpointForSsrf(parsed.data.endpoint);
    if (!ssrf.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid agent endpoint: ${ssrf.reason}`,
        ssrfBlocked: true,
      });
    }
  }

  try {
    const updated = await runtimeDb.updateAgent(req.params.id, parsed.data, req.authUser);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: safeFailure(err, 'Unable to update agent.') });
  }
});

// Delete agent
apiRouter.delete('/agents/:id', async (req: Request, res: Response) => {
  const deleted = await runtimeDb.deleteAgent(req.params.id, req.authUser);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }
  res.json({ success: true, message: 'Agent deleted successfully' });
});

// Test Agent Connection (Health Check)
apiRouter.post('/agents/:id/test-connection', async (req: Request, res: Response) => {
  const record = await runtimeDb.getAgentWithSecret(req.params.id, req.authUser);
  if (!record) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }

  const { agent, secret } = record;
  const adapter = new AgentHttpAdapter(
    agent.endpoint,
    {
      type: agent.authType,
      headerName: agent.authHeaderName,
      secret,
    }
  );

  const testResult = await adapter.checkHealth();
  const updatedAgent = await runtimeDb.updateAgentStatus(agent.id, {
    success: testResult.success,
    statusCode: testResult.statusCode,
    latencyMs: testResult.latencyMs,
    resolvedIp: testResult.resolvedIp,
    healthPayload: testResult.healthPayload,
    errorMessage: testResult.errorMessage,
    testedAt: new Date().toISOString(),
  }, req.authUser);

  res.json({
    success: testResult.success,
    testResult,
    agent: updatedAgent,
  });
});

apiRouter.get('/agents/:id/connection-logs', async (req: Request, res: Response) => {
  const agent = await runtimeDb.getAgent(req.params.id, req.authUser);
  if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
  const logs = await runtimeDb.getConnectionLogs(req.params.id, req.authUser);
  if (!logs) return res.status(404).json({ success: false, error: 'Agent not found' });
  return res.json({ success: true, data: logs, count: logs.length });
});

// Execute Standardized Task against Agent
apiRouter.post('/agents/:id/execute', async (req: Request, res: Response) => {
  const record = await runtimeDb.getAgentWithSecret(req.params.id, req.authUser);
  if (!record) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }

  const { agent, secret } = record;

  const payload: StandardizedAgentRequest = {
    protocolVersion: '1.0',
    requestId: req.body?.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    task: {
      taskId: req.body?.task?.taskId || `task-${Date.now()}`,
      title: req.body?.task?.title || 'Reverse a String',
      description: req.body?.task?.description || 'Write a function that reverses an input string.',
      language: req.body?.task?.language || agent.supportedLanguages[0] || 'typescript',
      input: req.body?.task?.input || { testCase: 'AgentArena' },
    },
    constraints: {
      timeoutSeconds: req.body?.constraints?.timeoutSeconds || 30,
      maxOutputSizeBytes: req.body?.constraints?.maxOutputSizeBytes || 100_000,
    },
  };

  const adapter = new AgentHttpAdapter(
    agent.endpoint,
    {
      type: agent.authType,
      headerName: agent.authHeaderName,
      secret,
    }
  );

  const execResult = await adapter.executeTask(payload);
  res.json({
    success: execResult.success,
    durationMs: execResult.durationMs,
    statusCode: execResult.statusCode,
    response: execResult.response,
    errorMessage: execResult.errorMessage,
    request: payload,
  });
});

// Direct SSRF & Health verification endpoint for UI registration wizard
apiRouter.post('/test-endpoint-direct', async (req: Request, res: Response) => {
  const { endpoint, authType = 'NONE', authHeaderName, authSecret } = req.body;
  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ success: false, error: 'Endpoint URL is required' });
  }

  const ssrf = await validateEndpointForSsrf(endpoint);
  if (!ssrf.valid) {
    return res.json({
      success: false,
      ssrfBlocked: true,
      reason: ssrf.reason,
    });
  }

  const adapter = new AgentHttpAdapter(
    endpoint,
    {
      type: authType,
      headerName: authHeaderName,
      secret: authSecret,
    }
  );

  const testResult = await adapter.checkHealth();
  res.json({
    success: testResult.success,
    ssrfBlocked: false,
    testResult,
  });
});

// ==========================================
// 4. Benchmark Task Management Endpoints
// ==========================================

// List all tasks
apiRouter.get('/tasks', async (req: Request, res: Response) => {
  const language = req.query.language as string | undefined;
  const difficulty = req.query.difficulty as string | undefined;
  const activeOnly = req.query.activeOnly === 'true';

  const tasks = await runtimeDb.listTasks({ language, difficulty, activeOnly }, req.authUser);
  res.json({ success: true, data: tasks, count: tasks.length });
});

// Get task by ID
apiRouter.get('/tasks/:id', async (req: Request, res: Response) => {
  const task = await runtimeDb.getTask(req.params.id, req.authUser);
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }
  res.json({ success: true, data: task });
});

// Create task
apiRouter.post('/tasks', async (req: Request, res: Response) => {
  const parsed = CreateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      issues: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  const task = await runtimeDb.createTask(parsed.data, req.authUser);
  res.status(201).json({ success: true, data: task });
});

// Update task
apiRouter.put('/tasks/:id', async (req: Request, res: Response) => {
  const existing = await runtimeDb.getTask(req.params.id, req.authUser);
  if (!existing) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  const parsed = UpdateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      issues: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  const updated = await runtimeDb.updateTask(req.params.id, parsed.data, req.authUser);
  res.json({ success: true, data: updated });
});

// Delete task
apiRouter.delete('/tasks/:id', async (req: Request, res: Response) => {
  const deleted = await runtimeDb.deleteTask(req.params.id, req.authUser);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }
  res.json({ success: true, message: 'Task deleted successfully' });
});

// ==========================================
// 5. Benchmark Execution Orchestration Endpoints
// ==========================================

// List all benchmark runs
apiRouter.get('/runs', async (req: Request, res: Response) => {
  const runs = await runtimeDb.listRuns(req.authUser);
  res.json({ success: true, data: runs, count: runs.length });
});

// Get single benchmark run with live execution status
apiRouter.get('/runs/:id', async (req: Request, res: Response) => {
  const run = await runtimeDb.getRun(req.params.id, req.authUser);
  if (!run) {
    return res.status(404).json({ success: false, error: 'Benchmark run not found' });
  }
  res.json({ success: true, data: run });
});

// Launch a new benchmark run (requires >= 2 eligible agents)
apiRouter.post('/runs', async (req: Request, res: Response) => {
  const parsed = CreateRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      issues: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  try {
    const waitForCompletion = req.query.wait === 'true';
    const run = await BenchmarkOrchestrator.createAndLaunchRun(parsed.data, {
      waitForCompletion,
      actor: req.authUser,
    });

    res.status(201).json({
      success: true,
      data: run,
      message: run.executions.some(e => e.errorMessage === 'Background queue is unavailable; execution was not started.')
        ? 'Run recorded but not started because the background queue is unavailable.'
        : 'Benchmark run orchestrated successfully',
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: safeFailure(err, 'Unable to start benchmark run.'),
    });
  }
});

// ==========================================
// 6. Stage 5: Evaluation Engine Endpoints
// ==========================================

// Get centralized evaluation configuration & weights
apiRouter.get('/evaluations/config', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      version: '1.0.0',
      weights: DEFAULT_EVALUATION_WEIGHTS,
      criteria: [
        { name: 'Accuracy / Correctness', weight: '40%', description: 'Code structure, language syntax, expected output alignment' },
        { name: 'Task Completion', weight: '25%', description: 'Non-empty valid solution produced under status COMPLETED' },
        { name: 'Reliability', weight: '15%', description: 'Zero unhandled exceptions or crash dumps during execution' },
        { name: 'Execution Speed', weight: '10%', description: 'Normalized execution duration vs allocated time budget' },
        { name: 'Cost Efficiency', weight: '10%', description: 'Token consumption efficiency (dynamically re-normalized if unavailable)' },
      ],
    },
  });
});

// Evaluate a completed benchmark run
apiRouter.post('/runs/:id/evaluate', async (req: Request, res: Response) => {
  const run = await runtimeDb.getRun(req.params.id, req.authUser);
  if (!run) {
    return res.status(404).json({ success: false, error: 'Benchmark run not found' });
  }

  // Reject evaluations for runs still active
  if (run.status === 'RUNNING' || run.status === 'QUEUED') {
    return res.status(400).json({
      success: false,
      error: 'Cannot evaluate an active or queued benchmark run. Wait until all executions complete.',
    });
  }

  const task = await runtimeDb.getTask(run.taskId, req.authUser);
  if (!task) {
    return res.status(404).json({ success: false, error: 'Benchmark task definition missing' });
  }

  const parsed = EvaluateRunSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid evaluation parameters',
      issues: parsed.error.issues,
    });
  }

  const recalculate = req.query.recalculate === 'true' || parsed.data.recalculate;
  const existingEvals = await runtimeDb.listEvaluations(run.id);

  if (existingEvals.length > 0 && !recalculate && !parsed.data.aiAssisted) {
    return res.json({
      success: true,
      data: existingEvals,
      message: 'Retrieved existing evaluations. Pass recalculate=true to re-evaluate.',
      cached: true,
    });
  }

  try {
    const engine = new EvaluationEngine(parsed.data.weights);
    const evaluations = run.executions.map(execution => {
      return engine.evaluateExecution(task, execution);
    });

    if (parsed.data.aiAssisted) {
      const reviews = await Promise.all(run.executions
        .filter(execution => execution.status === 'COMPLETED')
        .map(async execution => [execution.id, await reviewSemanticCorrectness(task, execution)] as const));
      const byExecution = new Map(reviews);
      for (const evaluation of evaluations) {
        const semanticReview = byExecution.get(evaluation.executionId);
        if (semanticReview) evaluation.breakdown.semanticReview = semanticReview;
      }
    }

    await runtimeDb.saveEvaluations(evaluations);

    res.json({
      success: true,
      data: evaluations,
      message: parsed.data.aiAssisted
        ? `Evaluated ${evaluations.length} agent executions; semantic AI review completed for ${evaluations.filter(e => e.breakdown.semanticReview).length}.`
        : `Evaluated ${evaluations.length} agent executions successfully`,
      aiAssisted: parsed.data.aiAssisted,
      weightsUsed: engine.getWeights(),
    });
  } catch (err: any) {
    if (err instanceof SemanticReviewError) return res.status(err.statusCode).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: safeFailure(err, 'Unable to save evaluations.') });
  }
});

// Retrieve evaluations for a benchmark run
apiRouter.get('/runs/:id/evaluations', async (req: Request, res: Response) => {
  const run = await runtimeDb.getRun(req.params.id, req.authUser);
  if (!run) {
    return res.status(404).json({ success: false, error: 'Benchmark run not found' });
  }

  const evals = await runtimeDb.listEvaluations(run.id);
  res.json({
    success: true,
    data: evals,
    count: evals.length,
  });
});

// Retrieve an individual evaluation by ID
apiRouter.get('/evaluations/:id', async (req: Request, res: Response) => {
  const ev = await runtimeDb.getEvaluation(req.params.id, req.authUser);
  if (!ev) {
    return res.status(404).json({ success: false, error: 'Evaluation not found' });
  }
  res.json({ success: true, data: ev });
});

// ==========================================
// 7. Stage 6: Leaderboard & Analytics
// ==========================================

// Global Leaderboard with filters
apiRouter.get('/leaderboard', async (req: Request, res: Response) => {
  const language = req.query.language as string | undefined;
  const category = req.query.category as string | undefined;

  const snapshot = runtimeDb.isPrismaEnabled ? await runtimeDb.analyticsSnapshot(req.authUser) : undefined;
  const entries = analyticsService.getLeaderboard({ language, category }, snapshot);
  res.json({
    success: true,
    data: entries,
    count: entries.length,
    filters: { language, category },
  });
});

// Analytics Dashboard summary metrics
apiRouter.get('/analytics', async (req: Request, res: Response) => {
  const snapshot = runtimeDb.isPrismaEnabled ? await runtimeDb.analyticsSnapshot(req.authUser) : undefined;
  const analytics = analyticsService.getAnalytics(snapshot);
  res.json({
    success: true,
    data: analytics,
  });
});

// Export benchmark run report (CSV or JSON)
apiRouter.get('/runs/:id/export', async (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'json';
  const snapshot = runtimeDb.isPrismaEnabled ? await runtimeDb.analyticsSnapshot(req.authUser) : undefined;
  const report = analyticsService.generateRunReport(req.params.id, snapshot);

  if (!report) {
    return res.status(404).json({ success: false, error: 'Benchmark run not found' });
  }

  if (format.toLowerCase() === 'csv') {
    const csvContent = analyticsService.exportReportCsv(report);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="benchmark-${report.runId}.csv"`);
    return res.send(csvContent);
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="benchmark-${report.runId}.json"`);
  res.json(report);
});

// ==========================================
// 8. Stage 7: Advanced Infrastructure Status
// ==========================================

apiRouter.get('/infrastructure/status', async (_req: Request, res: Response) => {
  const dockerAvailability = await DockerExecutor.checkAvailability();
  const dockerSecurity = DockerExecutor.getSecurityProfile();
  const queueStatus = await queueService.getStatus();
  const bifrostStatus = BifrostGateway.getStatus();

  res.json({
    success: true,
    data: {
      timestamp: new Date().toISOString(),
      docker: {
        status: dockerAvailability.status,
        isolationReady: dockerAvailability.available,
        reason: dockerAvailability.reason,
        securitySettings: dockerSecurity,
      },
      redis: queueStatus.redis,
      bullmq: queueStatus.bullmq,
      bifrost: bifrostStatus,
    },
  });
});
