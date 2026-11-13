import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './src/server/routes';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = (process.env.CORS_ORIGINS || (isProduction ? '' : 'http://localhost:3000,http://127.0.0.1:3000')).split(',').map(v => v.trim()).filter(Boolean);
  if (isProduction && !allowedOrigins.length) throw new Error('CORS_ORIGINS must contain the explicit production origin allowlist.');
  if (isProduction) {
    if (!process.env.AGENTARENA_SECRET_KEY || !/^[0-9a-fA-F]{64}$/.test(process.env.AGENTARENA_SECRET_KEY)) throw new Error('AGENTARENA_SECRET_KEY must be configured as 64 hexadecimal characters in production.');
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in production; JSON persistence is not production-safe.');
  }

  // Request body parsing with strict size limits
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Basic security, CORS & rate-limiting for Arena
  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

  app.use((req, res, next) => {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // CORS headers
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    if (req.method === 'OPTIONS') {
      if (origin && !allowedOrigins.includes(origin)) return res.sendStatus(403);
      return res.sendStatus(204);
    }

    // In-memory Rate Limiting (120 reqs / min per client IP)
    const clientIp = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    if (rateLimitBuckets.size > 10000) {
      for (const [key, value] of rateLimitBuckets) if (now > value.resetAt) rateLimitBuckets.delete(key);
      if (rateLimitBuckets.size > 10000) rateLimitBuckets.clear();
    }
    let bucket = rateLimitBuckets.get(clientIp);

    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + 60_000 };
      rateLimitBuckets.set(clientIp, bucket);
    }

    bucket.count++;
    if (bucket.count > 120 && req.path.startsWith('/api') && req.path !== '/api/health') {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({
        success: false,
        error: 'Too Many Requests: Rate limit exceeded. Please retry after a brief delay.',
      });
    }

    next();
  });

  // Liveness endpoint (does not imply database/queue readiness).
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'agentarena' }));

  // Mount API endpoints
  app.use('/api', apiRouter);

  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    if (isProduction) {
      console.error('[AgentArena] Request failed', { name: err?.name || 'Error' });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  });

  if (!isProduction) {
    // Development mode: Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    // Production mode: Serve built static assets
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[AgentArena] Server running on http://0.0.0.0:${PORT}`);
    console.log(`[AgentArena] Production server active`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`[AgentArena] Received ${signal}. Initiating graceful shutdown...`);
    server.close(async () => {
      try {
        const { queueService } = await import('./src/server/infrastructure/queue');
        await queueService.shutdown();
        console.log('[AgentArena] Queue and server connections closed cleanly.');
      } catch (err: any) {
        console.error('[AgentArena] Error during queue shutdown:', err.message);
      }
      process.exit(0);
    });

    // Force exit after 10 seconds if hanging
    setTimeout(() => {
      console.error('[AgentArena] Shutdown timed out. Forcing process exit.');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch(err => {
  console.error('[AgentArena] Fatal startup error:', err);
  process.exit(1);
});
