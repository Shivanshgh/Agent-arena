import 'dotenv/config';

process.env.AGENTARENA_WORKER_ENABLED = 'true';
const { getRedisClient, queueService } = await import('./src/server/infrastructure/queue');
const { connectRuntimeDb, shutdownRuntimeDb } = await import('./src/server/runtime-db');
const redis = getRedisClient();
if (!redis) throw new Error('Redis worker could not initialize');
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required by the production worker.');
await connectRuntimeDb();

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[AgentArena Worker] ${signal}: graceful shutdown`);
  await queueService.shutdown();
  await shutdownRuntimeDb();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
console.log('[AgentArena Worker] Starting benchmark worker; waiting for Redis connection');
