import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';

// Redis connection options from environment
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_URL = process.env.REDIS_URL;

let redisClient: Redis | null = null;
let benchmarkQueue: Queue | null = null;
let benchmarkWorker: Worker | null = null;
let redisConnected = false;
let redisError: string | null = null;
let connectionAttempted = false;

/**
 * Initializes Redis connection safely without crashing on failure
 */
export function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;
  if (connectionAttempted && !redisConnected) return null;

  connectionAttempted = true;

  try {
    const opts: any = {
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => times > 5 ? null : Math.min(times * 500, 2500),
      lazyConnect: true,
      connectTimeout: 2000,
      enableOfflineQueue: false,
    };

    if (REDIS_PASSWORD) opts.password = REDIS_PASSWORD;

    redisClient = REDIS_URL
      ? new Redis(REDIS_URL, opts)
      : new Redis(REDIS_PORT, REDIS_HOST, opts);

    redisClient.on('connect', () => {
      redisConnected = true;
      redisError = null;
    });

    redisClient.on('error', (err) => {
      redisConnected = false;
      redisError = err.message;
    });

    // Attempt initial connect asynchronously
    redisClient.connect().then(() => {
      redisConnected = true;
      initQueue();
    }).catch(err => {
      redisConnected = false;
      redisError = err.message;
    });

    return redisClient;
  } catch (err: any) {
    redisConnected = false;
    redisError = err.message;
    return null;
  }
}

/**
 * Initializes BullMQ Queue and Worker if Redis is online
 */
function getBullConnectionOptions(): any {
  if (!REDIS_URL) return { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD, maxRetriesPerRequest: null };
  const parsed = new URL(REDIS_URL);
  const database = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
  return { host: parsed.hostname, port: Number(parsed.port || (parsed.protocol === 'rediss:' ? 6380 : 6379)), username: parsed.username || undefined, password: parsed.password || undefined, db: Number.isFinite(database) ? database : 0, tls: parsed.protocol === 'rediss:' ? {} : undefined, maxRetriesPerRequest: null };
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
    benchmarkWorker?.on('failed', (job, error) => console.error('[BullMQ] Benchmark job failed', { jobId: job?.id, message: error.message }));
    benchmarkWorker?.on('error', error => { redisError = error.message; });
  } catch (err: any) {
    console.error('[BullMQ] Initialization error:', err.message);
  }
}

export const queueService = {
  /**
   * Enqueues a benchmark run job with idempotency (jobId = runId)
   */
  async enqueueRunJob(runId: string, payload: any): Promise<{ enqueued: boolean; jobId?: string; reason?: string }> {
    const client = getRedisClient();
    if (!client || !redisConnected || !benchmarkQueue) {
      return {
        enqueued: false,
        reason: 'Redis / BullMQ background queue is offline or unprovisioned. Using direct in-process execution.',
      };
    }

    try {
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
      return { enqueued: false, reason: err.message };
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
        }
      } catch {
        redisConnected = false;
      }
    }

    return {
      redis: {
        status: redisConnected ? 'CONNECTED' : 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE',
        host: REDIS_HOST,
        port: REDIS_PORT,
        latencyMs,
        error: redisConnected ? null : (redisError || 'Redis server not running on port 6379'),
      },
      bullmq: {
        status: redisConnected && benchmarkQueue ? 'ACTIVE' : 'OFFLINE',
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
