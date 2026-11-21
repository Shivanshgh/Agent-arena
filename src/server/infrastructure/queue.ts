import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';

// Redis connection options from environment
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_URL = process.env.REDIS_URL?.trim();

let redisClient: Redis | null = null;
let benchmarkQueue: Queue | null = null;
let benchmarkWorker: Worker | null = null;
let redisConnected = false;
let redisError: string | null = null;
let queueReady = false;
let localWorkerReady = false;
let connectionAttempted = false;
let lastLoggedRedisError: string | null = null;

function safeRedisError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(rediss?:\/\/)[^@\s]+@/gi, '$1[credentials-redacted]@').slice(0, 400);
}

function redisTarget(): { host: string; port: number } {
  if (REDIS_URL) {
    try {
      const target = new URL(REDIS_URL);
      return { host: target.hostname, port: Number(target.port || (target.protocol === 'rediss:' ? 6380 : 6379)) };
    } catch { return { host: 'invalid REDIS_URL', port: 0 }; }
  }
  return { host: REDIS_HOST, port: REDIS_PORT };
}

export function redisRetryDelay(attempt: number): number | null {
  if (process.env.NODE_ENV === 'test' && attempt > 5) return null;
  return Math.min(Math.max(1, attempt) * 500, 2500);
}

/**
 * Initializes Redis connection safely without crashing on failure
 */
export function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;
  if (connectionAttempted && !redisConnected) return null;

  if (process.env.NODE_ENV === 'production' && !REDIS_URL?.trim()) {
    redisError = 'REDIS_URL is required in production; configure the same Redis URL for the API and worker.';
    return null;
  }

  if (REDIS_URL) {
    try {
      const parsed = new URL(REDIS_URL);
      if (!['redis:', 'rediss:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('REDIS_URL must use redis:// or rediss:// and include a host.');
    } catch (error) {
      redisError = safeRedisError(error);
      return null;
    }
  }

  connectionAttempted = true;

  try {
    const opts: any = {
      maxRetriesPerRequest: 1,
      // Keep production/development clients reconnecting if Redis restarts; tests cap retries to exit cleanly.
      retryStrategy: redisRetryDelay,
      lazyConnect: true,
      connectTimeout: 2000,
      enableOfflineQueue: false,
    };

    if (REDIS_PASSWORD) opts.password = REDIS_PASSWORD;

    redisClient = REDIS_URL
      ? new Redis(REDIS_URL, opts)
      : new Redis(REDIS_PORT, REDIS_HOST, opts);

    redisClient.on('ready', () => {
      redisConnected = true;
      redisError = null;
      lastLoggedRedisError = null;
      initQueue();
    });

    redisClient.on('error', (err) => {
      redisConnected = false;
      redisError = safeRedisError(err);
      if (redisError !== lastLoggedRedisError) {
        console.error('[BullMQ] Redis connection error', { error: redisError });
        lastLoggedRedisError = redisError;
      }
    });

    redisClient.on('close', () => { redisConnected = false; queueReady = false; });

    // Attempt initial connect asynchronously
    redisClient.connect().then(() => {
      redisConnected = true;
      initQueue();
    }).catch(err => {
      redisConnected = false;
      redisError = safeRedisError(err);
    });

    return redisClient;
  } catch (err: any) {
    redisConnected = false;
    redisError = safeRedisError(err);
    return null;
  }
}

/**
 * Initializes BullMQ Queue and Worker if Redis is online
 */
export function getBullConnectionOptions(redisUrl = REDIS_URL): any {
  if (!redisUrl) return { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD, maxRetriesPerRequest: null };
  const parsed = new URL(redisUrl);
  const database = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === 'rediss:' ? 6380 : 6379)),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isFinite(database) ? database : 0,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

function initQueue() {
  if (!redisClient || !redisConnected || benchmarkQueue) return;

  try {
    const queueConnection = getBullConnectionOptions();

    benchmarkQueue = new Queue('benchmark-execution', {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
    benchmarkQueue.on('error', error => {
      queueReady = false;
      redisError = safeRedisError(error);
      console.error('[BullMQ] Queue connection error', { error: redisError });
    });
    void benchmarkQueue.waitUntilReady().then(() => { queueReady = true; }).catch(error => {
      queueReady = false;
      redisError = safeRedisError(error);
      console.error('[BullMQ] Queue failed to become ready', { error: redisError });
    });

    if (process.env.AGENTARENA_WORKER_ENABLED === 'true') benchmarkWorker = new Worker(
      'benchmark-execution',
      async (job: Job) => {
        const runId = typeof job.data?.runId === 'string' ? job.data.runId : '';
        if (!runId) throw new Error('Benchmark queue job is missing runId');
        const { BenchmarkOrchestrator } = await import('../orchestrator');
        await BenchmarkOrchestrator.resumeRun(runId);
        return { processed: true, runId };
      },
      {
        connection: queueConnection,
        concurrency: 5,
      }
    );
    benchmarkWorker?.on('failed', (job, error) => {
      console.error('[BullMQ] Benchmark job failed', { jobId: job?.id, error: error.name });
      if (!job || job.attemptsMade < (job.opts.attempts || 1) || typeof job.data?.runId !== 'string') return;
      void (async () => {
        const { runtimeDb } = await import('../runtime-db');
        const run = await runtimeDb.getRun(job.data.runId);
        for (const execution of run?.executions.filter(item => ['QUEUED', 'RUNNING'].includes(item.status)) || []) {
          await runtimeDb.updateExecution(job.data.runId, execution.id, {
            status: 'FAILED', completedAt: new Date().toISOString(),
            errorMessage: 'Benchmark worker failed after retry limit.',
          });
        }
        for (const execution of run?.modelExecutions?.filter(item => ['QUEUED', 'RUNNING'].includes(item.status)) || []) {
          await runtimeDb.updateModelExecution(job.data.runId, execution.id, {
            status: 'FAILED', completedAt: new Date().toISOString(),
            errorMessage: 'Benchmark worker failed after retry limit.',
          });
        }
      })().catch(failure => console.error('[BullMQ] Failed to persist terminal run state', { error: failure instanceof Error ? failure.name : 'Error' }));
    });
    benchmarkWorker?.on('ready', () => { localWorkerReady = true; });
    benchmarkWorker?.on('closing', () => { localWorkerReady = false; });
    benchmarkWorker?.on('error', error => {
      localWorkerReady = false;
      redisError = safeRedisError(error);
      console.error('[BullMQ] Worker connection error', { error: redisError });
    });
  } catch (err: any) {
    redisError = safeRedisError(err);
    console.error('[BullMQ] Initialization error', { error: redisError });
  }
}

async function waitForRedisReady(timeoutMs = 10_000): Promise<void> {
  const client = getRedisClient();
  if (!client) throw new Error(redisError || 'Redis client is not configured.');
  if (client.status !== 'ready') {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Redis did not become ready within ${timeoutMs}ms${redisError ? `: ${redisError}` : '.'}`));
      }, timeoutMs);
      const ready = () => { cleanup(); resolve(); };
      const ended = () => { cleanup(); reject(new Error(redisError || 'Redis connection ended before becoming ready.')); };
      const cleanup = () => {
        clearTimeout(timer);
        client.off('ready', ready);
        client.off('end', ended);
      };
      client.once('ready', ready);
      client.once('end', ended);
      if (client.status === 'ready') ready();
    });
  }
  redisConnected = true;
  initQueue();
  if (!benchmarkQueue) throw new Error(redisError || 'BullMQ queue could not initialize.');
  await withTimeout(benchmarkQueue.waitUntilReady(), timeoutMs, 'BullMQ queue');
  if (benchmarkWorker) await withTimeout(benchmarkWorker.waitUntilReady(), timeoutMs, 'BullMQ worker');
  queueReady = true;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, component: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${component} did not become ready within ${timeoutMs}ms.`)), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export const queueService = {
  async waitUntilReady(timeoutMs = 10_000): Promise<void> {
    await waitForRedisReady(timeoutMs);
  },

  /**
   * Enqueues a benchmark run job with idempotency (jobId = runId)
   */
  async enqueueRunJob(runId: string, payload: any): Promise<{ enqueued: boolean; jobId?: string; reason?: string }> {
    try {
      await waitForRedisReady();
      if (!benchmarkQueue) throw new Error('BullMQ queue is unavailable after Redis became ready.');
      const existing = await benchmarkQueue.getJob(runId);
      if (existing) {
        const state = await existing.getState();
        if (['completed', 'active', 'waiting', 'delayed'].includes(state)) return { enqueued: true, jobId: runId };
      }
      const job = await benchmarkQueue.add('execute-benchmark-run', payload, {
        jobId: runId,
        attempts: 2,
        backoff: { type: 'exponential', delay: 1500 },
      });
      return { enqueued: true, jobId: job.id };
    } catch (err: any) {
      const reason = safeRedisError(err);
      console.error('[BullMQ] Failed to enqueue benchmark', { runId, error: reason });
      return { enqueued: false, reason };
    }
  },

  /**
   * Checks Redis and BullMQ health status
   */
  async getStatus(): Promise<{
    redis: {
      status: 'CONNECTED' | 'DISCONNECTED' | 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE';
      host: string;
      port: number;
      latencyMs: number | null;
      error: string | null;
    };
    bullmq: {
      status: 'ACTIVE' | 'OFFLINE';
      queueName: string;
      concurrency: number;
      activeJobs: number;
      waitingJobs: number;
      completedJobs: number;
      failedJobs: number;
    };
  }> {
    getRedisClient(); // trigger initial check if not done

    let latencyMs: number | null = null;
    let counts: Record<string, number> = { active: 0, waiting: 0, completed: 0, failed: 0 };

    if (redisClient && redisConnected) {
      try {
        const start = performance.now();
        await redisClient.ping();
        latencyMs = Math.round(performance.now() - start);

        if (benchmarkQueue) {
          const rawCounts = await benchmarkQueue.getJobCounts('active', 'waiting', 'completed', 'failed');
          counts = { ...counts, ...rawCounts };
          await benchmarkQueue.waitUntilReady();
          queueReady = true;
        }
      } catch (error) {
        redisConnected = false;
        redisError = safeRedisError(error);
      }
    }

    return {
      redis: {
        status: redisConnected ? 'CONNECTED' : 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE',
        ...redisTarget(),
        latencyMs,
        error: redisConnected
          ? (!queueReady ? (redisError || 'BullMQ queue is not ready.') : null)
          : (redisError || 'Redis is not connected; check REDIS_URL and the Redis service.'),
      },
      bullmq: {
        status: redisConnected && benchmarkQueue && queueReady && (!benchmarkWorker || localWorkerReady) ? 'ACTIVE' : 'OFFLINE',
        queueName: 'benchmark-execution',
        concurrency: 5,
        activeJobs: counts.active || 0,
        waitingJobs: counts.waiting || 0,
        completedJobs: counts.completed || 0,
        failedJobs: counts.failed || 0,
      },
    };
  },

  /**
   * Graceful worker shutdown
   */
  async shutdown(): Promise<void> {
    if (benchmarkWorker) await benchmarkWorker.close();
    if (benchmarkQueue) await benchmarkQueue.close();
    if (redisClient) await redisClient.quit().catch(() => {});
  },
};
