import 'dotenv/config';

process.env.AGENTARENA_WORKER_ENABLED = 'true';
const { getRedisClient, queueService } = await import('./src/server/infrastructure/queue');
const redis = getRedisClient();
if (!redis) throw new Error('Redis worker could not initialize');

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[AgentArena Worker] ${signal}: graceful shutdown`);
  await queueService.shutdown();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
console.log('[AgentArena Worker] Starting benchmark worker; waiting for Redis connection');
