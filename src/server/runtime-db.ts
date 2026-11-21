import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { agentDb } from './db';
import { benchmarkDb } from './benchmark-db';
import { evaluationDb } from './evaluation-db';
import { encryptSecret, decryptSecret } from './crypto';
import { Agent, ConnectionTestResult, RegisterAgentInput, UpdateAgentInput } from '../types/agent';
import { AgentExecution, BenchmarkRun, BenchmarkTask, CreateTaskInput, ModelBenchmarkExecution, RunStatus, UpdateTaskInput } from '../types/benchmark';
import { ExecutionEvaluation } from '../types/evaluation';
import type { AuthUser } from './auth';
import { agentScope, runScope, taskReadScope, taskWriteScope } from './ownership';

const useJsonFixture = process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL;
const asJson = (value: unknown): Prisma.InputJsonValue => (value ?? {}) as Prisma.InputJsonValue;
const asObject = (value: Prisma.JsonValue | null): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const asDate = (value: string | null | undefined): Date | null => value ? new Date(value) : null;
const asDateUpdate = (value: string | null | undefined): Date | null | undefined => value === undefined ? undefined : value === null ? null : new Date(value);

function publicAgent(row: any): Agent {
  return {
    id: row.id, name: row.name, description: row.description || '', version: row.version,
    integrationType: row.integrationType, endpoint: row.endpoint,
    supportedLanguages: row.supportedLanguages, supportedCapabilities: row.supportedCapabilities,
    authType: row.authType, authHeaderName: row.authHeaderName || undefined,
    hasAuthSecret: Boolean(row.encryptedAuthSecret), connectionStatus: row.connectionStatus,
    lastSuccessfulConnection: row.lastSuccessfulConnection?.toISOString() || null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() || null, lastErrorMessage: row.lastErrorMessage,
    metadata: asObject(row.metadata), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

async function runtimeAgent(id: string, actor?: AuthUser) {
  if (useJsonFixture) return agentDb.getWithSecret(id);
  const row = await prisma.agent.findFirst({ where: { id, ...agentScope(actor) } });
  if (!row) return null;
  let secret: string | undefined;
  if (row.encryptedAuthSecret && row.authSecretIv && row.authSecretTag) {
    secret = decryptSecret({ encryptedData: row.encryptedAuthSecret, iv: row.authSecretIv, tag: row.authSecretTag });
  }
  return { agent: publicAgent(row), secret };
}

function mapTask(row: any): BenchmarkTask {
  return {
    id: row.id, title: row.title, description: row.description, language: row.language,
    category: row.category, difficulty: row.difficulty, inputData: asObject(row.inputData),
    expectedOutput: row.expectedOutput ?? undefined, evaluationStrategy: row.evaluationStrategy || 'CODE_UNVERIFIED', timeoutSeconds: row.timeoutSeconds,
    maxOutputSizeBytes: row.maxOutputSizeBytes, isActive: row.isActive,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRun(row: any): BenchmarkRun {
  const executions: AgentExecution[] = row.executions.map((e: any) => ({
    id: e.id, runId: e.runId, agentId: e.agentId, agentName: e.agent?.name || e.agentId,
    agentEndpoint: e.agent?.endpoint || '', requestId: e.requestId, status: e.status,
    startedAt: e.startedAt.toISOString(), completedAt: e.completedAt?.toISOString() || null,
    durationMs: e.durationMs ?? null, inputTokens: e.inputTokens ?? null, outputTokens: e.outputTokens ?? null,
    errorMessage: e.errorMessage ?? null, rawOutput: e.rawOutput ?? null,
    files: e.files && typeof e.files === 'object' ? e.files as Record<string, string> : undefined,
    metadata: asObject(e.metadata),
  }));
  const modelExecutions: ModelBenchmarkExecution[] = (row.modelExecutions || []).map((e: any) => ({
    id: e.id, runId: e.runId, connectionId: e.connectionId, provider: e.provider, modelId: e.modelId,
    requestId: e.requestId, status: e.status, startedAt: e.startedAt.toISOString(),
    completedAt: e.completedAt?.toISOString() || null, durationMs: e.durationMs ?? null,
    inputTokens: e.inputTokens ?? null, outputTokens: e.outputTokens ?? null,
    errorMessage: e.errorMessage ?? null, rawOutput: e.rawOutput ?? null,
    evaluation: e.evaluation ? {
      accuracyScore: e.evaluation.accuracyScore, completionScore: e.evaluation.completionScore,
      reliabilityScore: e.evaluation.reliabilityScore, speedScore: e.evaluation.speedScore,
      costEfficiencyScore: e.evaluation.costEfficiencyScore, overallScore: e.evaluation.overallScore,
      evaluationStatus: e.evaluation.evaluationStatus, breakdown: asObject(e.evaluation.breakdown),
    } : null,
  }));
  return {
    id: row.id, title: row.title, taskId: row.taskId, taskTitle: row.task?.title || row.taskId,
    taskLanguage: row.task?.language || '', taskDescription: row.task?.description || '',
    taskDifficulty: row.task?.difficulty || 'MEDIUM', agentIds: executions.map((e) => e.agentId),
    status: row.status, startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() || null,
    durationMs: row.durationMs ?? null, executions, modelExecutions, createdAt: row.startedAt.toISOString(),
  };
}

async function runById(id: string, tx: Prisma.TransactionClient | typeof prisma = prisma, actor?: AuthUser): Promise<BenchmarkRun | null> {
  const row = await tx.benchmarkRun.findFirst({
    where: { id, ...runScope(actor) }, include: { task: true, executions: { include: { agent: true }, orderBy: { startedAt: 'asc' } }, modelExecutions: { include: { evaluation: true }, orderBy: { startedAt: 'asc' } } },
  });
  return row ? mapRun(row) : null;
}

function mapEvaluation(row: any): ExecutionEvaluation {
  return {
    id: row.id, runId: row.runId, executionId: row.executionId, agentId: row.agentId,
    agentName: row.agent?.name || row.agentId, taskId: row.taskId,
    accuracyScore: row.accuracyScore, completionScore: row.completionScore, reliabilityScore: row.reliabilityScore,
    speedScore: row.speedScore, costEfficiencyScore: row.costEfficiencyScore, overallScore: row.overallScore,
    passedTestCount: row.passedTestCount, failedTestCount: row.failedTestCount, totalTestCount: row.totalTestCount,
    evaluationStatus: row.evaluationStatus, evaluationVersion: row.evaluationVersion,
    breakdown: asObject(row.breakdown) as ExecutionEvaluation['breakdown'], evaluatedAt: row.createdAt.toISOString(),
  };
}

export const runtimeDb = {
  isPrismaEnabled: !useJsonFixture,
  async databaseReady(): Promise<boolean> {
    if (useJsonFixture) return false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  },
  async listAgents(actor?: AuthUser): Promise<Agent[]> {
    if (useJsonFixture) return agentDb.list();
    return (await prisma.agent.findMany({ where: agentScope(actor), orderBy: { createdAt: 'desc' } })).map(publicAgent);
  },
  async getAgent(id: string, actor?: AuthUser): Promise<Agent | null> {
    if (useJsonFixture) return agentDb.get(id);
    const row = await prisma.agent.findFirst({ where: { id, ...agentScope(actor) } });
    return row ? publicAgent(row) : null;
  },
  async getAgentWithSecret(id: string, actor?: AuthUser) { return runtimeAgent(id, actor); },
  async createAgent(input: RegisterAgentInput, actor?: AuthUser): Promise<Agent> {
    if (useJsonFixture) return agentDb.create(input);
    const encrypted = input.authSecret && input.authType !== 'NONE' ? encryptSecret(input.authSecret) : null;
    const row = await prisma.agent.create({ data: {
      ownerId: actor?.id, name: input.name, description: input.description || null, version: input.version || '1.0.0',
      integrationType: input.integrationType || 'HTTP', endpoint: input.endpoint,
      supportedLanguages: input.supportedLanguages, supportedCapabilities: input.supportedCapabilities || [],
      authType: input.authType || 'NONE', authHeaderName: input.authHeaderName || null,
      encryptedAuthSecret: encrypted?.encryptedData, authSecretIv: encrypted?.iv, authSecretTag: encrypted?.tag,
      metadata: asJson(input.metadata),
    } });
    return publicAgent(row);
  },
  async updateAgent(id: string, input: UpdateAgentInput, actor?: AuthUser): Promise<Agent | null> {
    if (useJsonFixture) return agentDb.update(id, input);
    const existing = await prisma.agent.findFirst({ where: { id, ...agentScope(actor) } });
    if (!existing) return null;
    let encrypted = existing.encryptedAuthSecret ? { encryptedData: existing.encryptedAuthSecret, iv: existing.authSecretIv!, tag: existing.authSecretTag! } : null;
    if (input.authSecret !== undefined || input.authType === 'NONE') {
      encrypted = input.authSecret && (input.authType ?? existing.authType) !== 'NONE' ? encryptSecret(input.authSecret) : null;
    }
    const row = await prisma.agent.update({ where: { id }, data: {
      name: input.name, description: input.description, version: input.version, integrationType: input.integrationType,
      endpoint: input.endpoint, supportedLanguages: input.supportedLanguages, supportedCapabilities: input.supportedCapabilities,
      authType: input.authType, authHeaderName: input.authHeaderName,
      encryptedAuthSecret: encrypted?.encryptedData, authSecretIv: encrypted?.iv, authSecretTag: encrypted?.tag,
      metadata: input.metadata === undefined ? undefined : asJson(input.metadata),
    } });
    return publicAgent(row);
  },
  async deleteAgent(id: string, actor?: AuthUser): Promise<boolean> {
    if (useJsonFixture) return agentDb.delete(id);
    return (await prisma.agent.deleteMany({ where: { id, ...agentScope(actor) } })).count > 0;
  },
  async updateAgentStatus(id: string, result: ConnectionTestResult, actor?: AuthUser): Promise<Agent | null> {
    if (useJsonFixture) return agentDb.updateStatus(id, result);
    const testedAt = asDate(result.testedAt) || new Date();
    const status = result.success ? 'CONNECTED' : result.errorMessage?.includes('SSRF') ? 'ERROR' : 'UNREACHABLE';
    const row = await prisma.$transaction(async (tx) => {
      const count = await tx.agent.updateMany({ where: { id, ...agentScope(actor) }, data: {
        connectionStatus: status, lastCheckedAt: testedAt,
        lastSuccessfulConnection: result.success ? testedAt : undefined,
        lastErrorMessage: result.success ? null : (result.errorMessage || 'Connection failed'),
      } });
      if (!count.count) return null;
      await tx.connectionLog.create({ data: {
        agentId: id, testedAt, success: result.success, statusCode: result.statusCode,
        latencyMs: result.latencyMs, resolvedIp: result.resolvedIp,
        errorMessage: result.errorMessage, responseBody: result.healthPayload ? asJson(result.healthPayload) : undefined,
      } });
      return tx.agent.findUnique({ where: { id } });
    });
    return row ? publicAgent(row) : null;
  },
  async listTasks(filters: { language?: string; difficulty?: string; activeOnly?: boolean } = {}, actor?: AuthUser): Promise<BenchmarkTask[]> {
    if (useJsonFixture) return benchmarkDb.listTasks(filters);
    return (await prisma.benchmarkTask.findMany({ where: {
      ...taskReadScope(actor),
      language: filters.language ? { equals: filters.language, mode: 'insensitive' } : undefined,
      difficulty: filters.difficulty as any, isActive: filters.activeOnly ? true : undefined,
    }, orderBy: { createdAt: 'desc' } })).map(mapTask);
  },
  async getTask(id: string, actor?: AuthUser): Promise<BenchmarkTask | null> {
    if (useJsonFixture) return benchmarkDb.getTask(id);
    const row = await prisma.benchmarkTask.findFirst({ where: { id, ...taskReadScope(actor) } });
    return row ? mapTask(row) : null;
  },
  async createTask(input: CreateTaskInput, actor?: AuthUser): Promise<BenchmarkTask> {
    if (useJsonFixture) return benchmarkDb.createTask(input);
    return mapTask(await prisma.benchmarkTask.create({ data: {
      ownerId: actor?.id, isShared: false, title: input.title, description: input.description, language: input.language, category: input.category || 'Algorithms',
      difficulty: input.difficulty || 'MEDIUM', inputData: asJson(input.inputData), expectedOutput: input.expectedOutput,
      evaluationStrategy: input.evaluationStrategy || 'CODE_UNVERIFIED',
      timeoutSeconds: input.timeoutSeconds || 60, maxOutputSizeBytes: input.maxOutputSizeBytes || 100000,
      isActive: input.isActive ?? true,
    } }));
  },
  async updateTask(id: string, input: UpdateTaskInput, actor?: AuthUser): Promise<BenchmarkTask | null> {
    if (useJsonFixture) return benchmarkDb.updateTask(id, input);
    if (!await prisma.benchmarkTask.findFirst({ where: { id, ...taskWriteScope(actor) }, select: { id: true } })) return null;
    return mapTask(await prisma.benchmarkTask.update({ where: { id }, data: {
      ...input, inputData: input.inputData === undefined ? undefined : asJson(input.inputData),
    } }));
  },
  async deleteTask(id: string, actor?: AuthUser): Promise<boolean> {
    if (useJsonFixture) return benchmarkDb.deleteTask(id);
    return (await prisma.benchmarkTask.deleteMany({ where: { id, ...taskWriteScope(actor) } })).count > 0;
  },
  async listRuns(actor?: AuthUser): Promise<BenchmarkRun[]> {
    if (useJsonFixture) return benchmarkDb.listRuns();
    const rows = await prisma.benchmarkRun.findMany({ where: runScope(actor), orderBy: { startedAt: 'desc' }, include: { task: true, executions: { include: { agent: true } }, modelExecutions: { include: { evaluation: true } } } });
    return rows.map(mapRun);
  },
  async getRun(id: string, actor?: AuthUser): Promise<BenchmarkRun | null> {
    if (useJsonFixture) return benchmarkDb.getRun(id);
    return runById(id, prisma, actor);
  },
  async createRun(run: BenchmarkRun, actor?: AuthUser): Promise<BenchmarkRun> {
    if (useJsonFixture) return benchmarkDb.createRun(run);
    await prisma.$transaction(async (tx) => {
      await tx.benchmarkRun.create({ data: {
        id: run.id, ownerId: actor?.id, title: run.title, taskId: run.taskId, status: run.status,
        startedAt: new Date(run.startedAt), completedAt: asDate(run.completedAt), durationMs: run.durationMs,
        executions: { create: run.executions.map((e) => ({
          id: e.id, agentId: e.agentId, requestId: e.requestId, status: e.status,
          startedAt: new Date(e.startedAt), completedAt: asDate(e.completedAt), durationMs: e.durationMs,
          inputTokens: e.inputTokens, outputTokens: e.outputTokens, errorMessage: e.errorMessage,
          rawOutput: e.rawOutput, files: e.files ? asJson(e.files) : undefined, metadata: asJson(e.metadata),
        })) },
        modelExecutions: run.modelExecutions?.length ? { create: run.modelExecutions.map(e => ({
          id: e.id, connectionId: e.connectionId, provider: e.provider, modelId: e.modelId,
          requestId: e.requestId, status: e.status, startedAt: new Date(e.startedAt),
          completedAt: asDate(e.completedAt), durationMs: e.durationMs, inputTokens: e.inputTokens,
          outputTokens: e.outputTokens, errorMessage: e.errorMessage, rawOutput: e.rawOutput,
        })) } : undefined,
      } });
    });
    return (await runById(run.id))!;
  },
  async updateRun(id: string, updates: Partial<BenchmarkRun>): Promise<BenchmarkRun | null> {
    if (useJsonFixture) return benchmarkDb.updateRun(id, updates);
    if (!await prisma.benchmarkRun.findUnique({ where: { id }, select: { id: true } })) return null;
    await prisma.benchmarkRun.update({ where: { id }, data: {
      title: updates.title, taskId: updates.taskId, status: updates.status,
      startedAt: updates.startedAt ? new Date(updates.startedAt) : undefined, completedAt: asDateUpdate(updates.completedAt), durationMs: updates.durationMs,
    } });
    return runById(id);
  },
  async updateExecution(runId: string, executionId: string, updates: Partial<AgentExecution>): Promise<BenchmarkRun | null> {
    if (useJsonFixture) return benchmarkDb.updateExecution(runId, executionId, updates);
    return prisma.$transaction(async (tx) => {
      const found = await tx.agentExecution.findFirst({ where: { id: executionId, runId }, select: { id: true } });
      if (!found) return null;
      await tx.agentExecution.update({ where: { id: executionId }, data: {
        status: updates.status, startedAt: updates.startedAt ? new Date(updates.startedAt) : undefined, completedAt: asDateUpdate(updates.completedAt),
        durationMs: updates.durationMs, inputTokens: updates.inputTokens, outputTokens: updates.outputTokens,
        errorMessage: updates.errorMessage, rawOutput: updates.rawOutput,
        files: updates.files === undefined ? undefined : asJson(updates.files),
        metadata: updates.metadata === undefined ? undefined : asJson(updates.metadata),
      } });
      const rows = await tx.agentExecution.findMany({ where: { runId }, select: { status: true } });
      const terminal = rows.every((e) => ['COMPLETED', 'FAILED', 'TIMED_OUT'].includes(e.status));
      const completed = rows.filter((e) => e.status === 'COMPLETED').length;
      const run = await tx.benchmarkRun.findUnique({ where: { id: runId }, select: { startedAt: true } });
      const status: RunStatus = !terminal ? 'RUNNING' : completed === rows.length ? 'COMPLETED' : completed > 0 ? 'PARTIALLY_FAILED' : 'FAILED';
      await tx.benchmarkRun.update({ where: { id: runId }, data: {
        status, completedAt: terminal ? new Date() : null,
        durationMs: terminal && run ? Math.max(0, Date.now() - run.startedAt.getTime()) : null,
      } });
      return runById(runId, tx);
    });
  },
  async updateModelExecution(runId: string, executionId: string, updates: Partial<ModelBenchmarkExecution>): Promise<BenchmarkRun | null> {
    if (useJsonFixture) return null;
    const found = await prisma.modelExecution.findFirst({ where: { id: executionId, runId }, select: { id: true } });
    if (!found) return null;
    await prisma.modelExecution.update({ where: { id: executionId }, data: {
      status: updates.status, startedAt: updates.startedAt ? new Date(updates.startedAt) : undefined,
      completedAt: asDateUpdate(updates.completedAt), durationMs: updates.durationMs,
      inputTokens: updates.inputTokens, outputTokens: updates.outputTokens,
      errorMessage: updates.errorMessage, rawOutput: updates.rawOutput,
    } });
    return this.refreshRunStatus(runId);
  },
  async refreshRunStatus(runId: string): Promise<BenchmarkRun | null> {
    if (useJsonFixture) return benchmarkDb.getRun(runId);
    return prisma.$transaction(async (tx) => {
      const rows = [
        ...await tx.agentExecution.findMany({ where: { runId }, select: { status: true } }),
        ...await tx.modelExecution.findMany({ where: { runId }, select: { status: true } }),
      ];
      const terminal = rows.length > 0 && rows.every((e) => ['COMPLETED', 'FAILED', 'TIMED_OUT'].includes(e.status));
      const completed = rows.filter((e) => e.status === 'COMPLETED').length;
      const run = await tx.benchmarkRun.findUnique({ where: { id: runId }, select: { startedAt: true } });
      if (!run) return null;
      const status: RunStatus = !terminal ? (rows.some(e => e.status === 'RUNNING') ? 'RUNNING' : 'QUEUED')
        : completed === rows.length ? 'COMPLETED' : completed > 0 ? 'PARTIALLY_FAILED' : 'FAILED';
      await tx.benchmarkRun.update({ where: { id: runId }, data: {
        status, completedAt: terminal ? new Date() : null,
        durationMs: terminal ? Math.max(0, Date.now() - run.startedAt.getTime()) : null,
      } });
      return runById(runId, tx);
    });
  },
  async listEvaluations(runId: string): Promise<ExecutionEvaluation[]> {
    if (useJsonFixture) return evaluationDb.listForRun(runId);
    return (await prisma.executionEvaluation.findMany({ where: { runId }, include: { agent: true }, orderBy: { createdAt: 'asc' } })).map(mapEvaluation);
  },
  async analyticsSnapshot(actor?: AuthUser) {
    if (useJsonFixture) {
      const agents = agentDb.list();
      const runs = benchmarkDb.listRuns();
      const tasks = benchmarkDb.listTasks();
      const evaluations = runs.flatMap((run) => evaluationDb.listForRun(run.id));
      return { agents, runs, tasks, evaluations };
    }
    const [agentRows, runRows, taskRows] = await Promise.all([
      prisma.agent.findMany({ where: agentScope(actor) }),
      prisma.benchmarkRun.findMany({ where: runScope(actor), include: { task: true, executions: { include: { agent: true } }, modelExecutions: { include: { evaluation: true } } } }),
      prisma.benchmarkTask.findMany({ where: taskReadScope(actor) }),
    ]);
    const runIds = runRows.map((r) => r.id);
    const evaluationRows = runIds.length ? await prisma.executionEvaluation.findMany({ where: { runId: { in: runIds } }, include: { agent: true } }) : [];
    return {
      agents: agentRows.map(publicAgent), runs: runRows.map(mapRun), tasks: taskRows.map(mapTask),
      evaluations: evaluationRows.map(mapEvaluation),
    };
  },
  async getEvaluation(id: string, actor?: AuthUser): Promise<ExecutionEvaluation | null> {
    if (useJsonFixture) return evaluationDb.get(id);
    const row = await prisma.executionEvaluation.findUnique({ where: { id }, include: { agent: true } });
    if (row && !await prisma.benchmarkRun.findFirst({ where: { id: row.runId, ...runScope(actor) }, select: { id: true } })) return null;
    return row ? mapEvaluation(row) : null;
  },
  async saveEvaluations(evaluations: ExecutionEvaluation[]): Promise<void> {
    if (useJsonFixture) { evaluationDb.saveEvaluations(evaluations); return; }
    await prisma.$transaction(evaluations.map((e) => prisma.executionEvaluation.upsert({
      where: { executionId: e.executionId },
      create: {
        id: e.id, runId: e.runId, executionId: e.executionId, agentId: e.agentId, taskId: e.taskId,
        accuracyScore: e.accuracyScore, completionScore: e.completionScore, reliabilityScore: e.reliabilityScore,
        speedScore: e.speedScore, costEfficiencyScore: e.costEfficiencyScore, overallScore: e.overallScore,
        passedTestCount: e.passedTestCount, failedTestCount: e.failedTestCount, totalTestCount: e.totalTestCount,
        evaluationStatus: e.evaluationStatus, evaluationVersion: e.evaluationVersion, breakdown: asJson(e.breakdown),
        createdAt: new Date(e.evaluatedAt),
      },
      update: {
        runId: e.runId, agentId: e.agentId, taskId: e.taskId, accuracyScore: e.accuracyScore,
        completionScore: e.completionScore, reliabilityScore: e.reliabilityScore, speedScore: e.speedScore,
        costEfficiencyScore: e.costEfficiencyScore, overallScore: e.overallScore, passedTestCount: e.passedTestCount,
        failedTestCount: e.failedTestCount, totalTestCount: e.totalTestCount, evaluationStatus: e.evaluationStatus,
        evaluationVersion: e.evaluationVersion, breakdown: asJson(e.breakdown), createdAt: new Date(e.evaluatedAt),
      },
    })));
  },
  async deleteEvaluationsForRun(runId: string): Promise<void> {
    if (useJsonFixture) { evaluationDb.deleteForRun(runId); return; }
    await prisma.executionEvaluation.deleteMany({ where: { runId } });
  },
  async getConnectionLogs(agentId: string, actor?: AuthUser) {
    if (useJsonFixture) return [];
    if (!await prisma.agent.findFirst({ where: { id: agentId, ...agentScope(actor) }, select: { id: true } })) return null;
    return prisma.connectionLog.findMany({ where: { agentId }, orderBy: { testedAt: 'desc' }, take: 100, select: {
      id: true, agentId: true, testedAt: true, success: true, statusCode: true, latencyMs: true,
      resolvedIp: true, errorMessage: true,
    } });
  },
};

export async function shutdownRuntimeDb() {
  if (!useJsonFixture) await prisma.$disconnect();
}

export async function connectRuntimeDb() {
  if (!useJsonFixture) await prisma.$connect();
}
