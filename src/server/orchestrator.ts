import crypto from 'crypto';
import { runtimeDb } from './runtime-db';
import { AgentHttpAdapter } from './http-adapter';
import { BenchmarkRun, AgentExecution, CreateRunInput } from '../types/benchmark';
import { StandardizedAgentRequest } from '../types/agent';
import type { AuthUser } from './auth';

// Set of actively running run IDs to prevent duplicate execution attempts
const activeRuns = new Set<string>();

export interface OrchestrationOptions {
  waitForCompletion?: boolean;
  actor?: AuthUser;
}

export class BenchmarkOrchestrator {
  /**
   * Validates and initializes a benchmark run
   */
  static async createAndLaunchRun(
    input: CreateRunInput,
    options: OrchestrationOptions = { waitForCompletion: false }
  ): Promise<BenchmarkRun> {
    if (process.env.NODE_ENV === 'production' && options.waitForCompletion) {
      throw new Error('Synchronous benchmark execution is disabled in production.');
    }
    // 1. Validation: At least two agents required
    if (!input.agentIds || input.agentIds.length < 2) {
      throw new Error('At least two eligible agents must be selected for a benchmark run.');
    }

    // Deduplicate agent IDs
    const uniqueAgentIds = Array.from(new Set(input.agentIds));
    if (uniqueAgentIds.length < 2) {
      throw new Error('You must select at least two distinct agents.');
    }

    // 2. Validate Task
    const task = await runtimeDb.getTask(input.taskId, options.actor);
    if (!task) {
      throw new Error(`Task with ID ${input.taskId} not found.`);
    }

    // 3. Validate Agents exist and are eligible
    const selectedAgentsWithSecret = await Promise.all(uniqueAgentIds.map(async (agentId) => {
      const record = await runtimeDb.getAgentWithSecret(agentId, options.actor);
      if (!record) {
        throw new Error(`Agent with ID ${agentId} not found.`);
      }
      return record;
    }));

    const runId = `run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();

    // 4. Create individual execution records
    const executions: AgentExecution[] = selectedAgentsWithSecret.map(({ agent }) => ({
      id: `exec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      runId,
      agentId: agent.id,
      agentName: agent.name,
      agentEndpoint: agent.endpoint,
      requestId: `req-${runId}-${agent.id}`,
      status: 'QUEUED',
      startedAt: now,
      completedAt: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      errorMessage: null,
      rawOutput: null,
      metadata: {},
    }));

    const runTitle = input.title || `Arena Battle: ${task.title} (${executions.length} Agents)`;

    const initialRun: BenchmarkRun = {
      id: runId,
      title: runTitle,
      taskId: task.id,
      taskTitle: task.title,
      taskLanguage: task.language,
      taskDescription: task.description,
      taskDifficulty: task.difficulty,
      agentIds: uniqueAgentIds,
      status: 'QUEUED',
      startedAt: now,
      completedAt: null,
      durationMs: null,
      executions,
      createdAt: now,
    };

    await runtimeDb.createRun(initialRun, options.actor);

    // 5. Prefer the durable Redis queue when available; direct execution is a dev fallback.
    if (!options.waitForCompletion) {
      const { queueService } = await import('./infrastructure/queue');
      const queued = await queueService.enqueueRunJob(runId, { runId });
      if (queued.enqueued) return initialRun;
      if (process.env.NODE_ENV === 'production') {
        const failedAt = new Date().toISOString();
        for (const execution of executions) {
          await runtimeDb.updateExecution(runId, execution.id, {
            status: 'FAILED', completedAt: failedAt,
            errorMessage: 'Background queue is unavailable; execution was not started.',
          });
        }
        return (await runtimeDb.getRun(runId, options.actor))!;
      }
    }

    await this.executeRun(runId, task, selectedAgentsWithSecret);
    return (await runtimeDb.getRun(runId, options.actor))!;
  }

  /** Reloads persisted run context for BullMQ worker execution. */
  static async resumeRun(runId: string): Promise<void> {
    let run = await runtimeDb.getRun(runId);
    if (!run) throw new Error(`Benchmark run ${runId} was not found`);
    if (['COMPLETED', 'FAILED', 'PARTIALLY_FAILED'].includes(run.status)) return;
    for (const execution of run.executions.filter((item) => item.status === 'RUNNING')) {
      await runtimeDb.updateExecution(runId, execution.id, {
        status: 'QUEUED', completedAt: null, errorMessage: 'Execution restarted after worker interruption.',
      });
    }
    run = (await runtimeDb.getRun(runId))!;
    const task = await runtimeDb.getTask(run.taskId);
    if (!task) throw new Error(`Benchmark task ${run.taskId} was not found`);
    const agents = (await Promise.all(run.executions.filter(e => e.status === 'QUEUED').map(e => runtimeDb.getAgentWithSecret(e.agentId)))).filter((v): v is NonNullable<typeof v> => Boolean(v));
    if (!agents.length) return;
    await this.executeRun(runId, task, agents);
  }

  /**
   * Executes the task against all selected agents concurrently using the Stage 3 HTTP Adapter
   */
  private static async executeRun(
    runId: string,
    task: NonNullable<Awaited<ReturnType<typeof runtimeDb.getTask>>>,
    agentsWithSecret: Array<{ agent: any; secret?: string }>
  ): Promise<void> {
    if (activeRuns.has(runId)) {
      return; // Prevent duplicate concurrent executions of the same run
    }
    activeRuns.add(runId);

    try {
      const run = await runtimeDb.getRun(runId);
      if (!run) return;

      // Dispatch identical task payload to all selected agents
      const executionPromises = run.executions.filter(e => e.status === 'QUEUED').map(async (execution) => {
        const agentRecord = agentsWithSecret.find(a => a.agent.id === execution.agentId);
        if (!agentRecord) return;

        const { agent, secret } = agentRecord;

        // Mark execution RUNNING
        await runtimeDb.updateExecution(runId, execution.id, {
          status: 'RUNNING',
          startedAt: new Date().toISOString(),
        });

        // Construct standardized Stage 3 request
        const taskRequest: StandardizedAgentRequest = {
          protocolVersion: '1.0',
          requestId: execution.requestId,
          task: {
            taskId: task.id,
            title: task.title,
            description: task.description,
            language: task.language,
            input: task.inputData || {},
          },
          constraints: {
            timeoutSeconds: task.timeoutSeconds || 60,
            maxOutputSizeBytes: task.maxOutputSizeBytes || 100_000,
          },
        };

        const adapter = new AgentHttpAdapter(
          agent.endpoint,
          {
            type: agent.authType,
            headerName: agent.authHeaderName,
            secret,
          },
          {
            timeoutMs: (task.timeoutSeconds || 60) * 1000,
            maxResponseSizeBytes: task.maxOutputSizeBytes || 100_000,
          }
        );

        const startTime = Date.now();

        try {
          // Execute task via HTTP Adapter
          const execResult = await adapter.executeTask(taskRequest, {
            timeoutSeconds: task.timeoutSeconds,
          });

          const endTime = Date.now();
          const measuredDuration = execResult.durationMs || (endTime - startTime);

          if (execResult.success && execResult.response) {
            const resData = execResult.response;
            await runtimeDb.updateExecution(runId, execution.id, {
              status: 'COMPLETED',
              completedAt: new Date().toISOString(),
              durationMs: measuredDuration,
              inputTokens: resData.metrics?.inputTokens ?? null,
              outputTokens: resData.metrics?.outputTokens ?? null,
              rawOutput: resData.result?.content || '',
              files: resData.result?.files,
              metadata: resData.metadata || {},
              errorMessage: null,
            });
          } else {
            // Failure or Timeout
            const isTimeout =
              execResult.response?.status === 'timed_out' ||
              execResult.errorMessage?.toLowerCase().includes('timed out');

            await runtimeDb.updateExecution(runId, execution.id, {
              status: isTimeout ? 'TIMED_OUT' : 'FAILED',
              completedAt: new Date().toISOString(),
              durationMs: measuredDuration,
              inputTokens: execResult.response?.metrics?.inputTokens ?? null,
              outputTokens: execResult.response?.metrics?.outputTokens ?? null,
              rawOutput: execResult.response?.result?.content || null,
              errorMessage: execResult.errorMessage || 'Agent execution failed',
              metadata: execResult.response?.metadata || {},
            });
          }
        } catch (err: any) {
          await runtimeDb.updateExecution(runId, execution.id, {
            status: 'FAILED',
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
            inputTokens: null,
            outputTokens: null,
            errorMessage: `Adapter exception: ${err.message}`,
            metadata: {},
          });
        }
      });

      // Use Promise.allSettled to guarantee that one failing agent never aborts other agents
      const outcomes = await Promise.allSettled(executionPromises);
      if (outcomes.some(outcome => outcome.status === 'rejected')) {
        throw new Error('One or more benchmark execution records could not be persisted.');
      }
      await runtimeDb.refreshRunStatus(runId);
    } finally {
      activeRuns.delete(runId);
    }
  }
}
