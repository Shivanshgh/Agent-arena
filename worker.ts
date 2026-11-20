import 'dotenv/config';

process.env.AGENTARENA_WORKER_ENABLED = 'true';
const { getRedisClient, queueService } = await import('./src/server/infrastructure/queue');
const { connectRuntimeDb, shutdownRuntimeDb } = await import('./src/server/runtime-db');
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required by the production worker.');
if (process.env.NODE_ENV === 'production' && !/^[0-9a-fA-F]{64}$/.test(process.env.AGENTARENA_SECRET_KEY || '')) {
  throw new Error('AGENTARENA_SECRET_KEY must be configured as 64 hexadecimal characters in the production worker.');
}
const redis = getRedisClient();
if (!redis) {
  const status = await queueService.getStatus();
  throw new Error(status.redis.error || 'Redis worker could not initialize. Configure REDIS_URL.');
}
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
console.log('[AgentArena Worker] Starting benchmark worker; waiting for Redis and BullMQ readiness');
void queueService.waitUntilReady().then(() => {
  console.log('[AgentArena Worker] Redis connected and BullMQ worker initialized');
}).catch(error => {
  console.error('[AgentArena Worker] Queue is not ready yet; Redis reconnects remain enabled.', {
    error: error instanceof Error ? error.message.replace(/(rediss?:\/\/)[^@\s]+@/gi, '$1[credentials-redacted]@').slice(0, 300) : 'Unknown queue initialization error',
  });
});
