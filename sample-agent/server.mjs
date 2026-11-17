import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT || 8080);
const agentKey = process.env.AGENT_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const maxBodyBytes = 1_000_000;
const maxOutputBytes = 100_000;

if (!agentKey || !geminiKey) {
  console.error('Set AGENT_API_KEY and GEMINI_API_KEY in the service environment.');
  process.exit(1);
}

function authorized(req) {
  const supplied = req.headers.authorization || '';
  const expected = `Bearer ${agentKey}`;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function respond(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function protocolError(requestId, code, message) {
  return {
    protocolVersion: '1.0', requestId: requestId || 'unknown', status: 'failed', result: null,
    metrics: { durationMs: 0, inputTokens: null, outputTokens: null },
    error: { code, message }, metadata: { agent: 'AgentArena Gemini Sample Agent' },
  };
}

function routeFor(pathname) {
  const match = pathname.match(/^\/(?:([a-z]+)\/)?(health|execute)$/);
  if (!match || !['concise', 'robust', undefined].includes(match[1])) return null;
  return { action: match[2], strategy: match[1] || 'balanced' };
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }); }
}

const server = createServer(async (req, res) => {
  const route = routeFor(new URL(req.url || '/', 'http://localhost').pathname);
  if (!route) return respond(res, 404, { error: 'Not found' });

  if (req.method === 'GET' && route.action === 'health') {
    if (!authorized(req)) return respond(res, 401, { error: 'Unauthorized' });
    return respond(res, 200, {
      status: 'healthy', version: '1.0.0', protocolVersion: '1.0',
      capabilities: ['code_generation'], uptimeSeconds: Math.floor(process.uptime()),
    });
  }

  if (req.method !== 'POST' || route.action !== 'execute') return respond(res, 404, { error: 'Not found' });
  if (!authorized(req)) return respond(res, 401, protocolError('unknown', 'UNAUTHORIZED', 'Valid Bearer authentication is required.'));

  let input;
  try { input = await readJson(req); }
  catch (error) {
    const status = error.statusCode || 400;
    return respond(res, status, protocolError('unknown', 'INVALID_REQUEST', error.message));
  }

  const task = input?.task;
  const requestId = typeof input?.requestId === 'string' ? input.requestId : 'unknown';
  if (input?.protocolVersion !== '1.0' || !task || typeof task.title !== 'string' ||
      typeof task.description !== 'string' || typeof task.language !== 'string') {
    return respond(res, 400, protocolError(requestId, 'INVALID_REQUEST', 'A valid AgentArena protocol v1.0 task is required.'));
  }

  const started = Date.now();
  const maxSeconds = Math.min(110, Math.max(5, Number(input.constraints?.timeoutSeconds) || 60));
  const prompt = [
    'You are a coding agent completing a benchmark task. Return only the complete solution source code, with no Markdown fences or commentary.',
    route.strategy === 'concise'
      ? 'Strategy: prefer the simplest correct implementation with minimal code while handling required edge cases.'
      : route.strategy === 'robust'
        ? 'Strategy: prioritize correctness across edge cases and use clear, maintainable structure without adding unnecessary code.'
        : 'Strategy: provide a straightforward, correct implementation.',
    `Language: ${task.language}`,
    `Title: ${task.title}`,
    `Description:\n${task.description}`,
    `Input data (JSON):\n${JSON.stringify(task.input ?? {})}`,
    `Constraints (JSON):\n${JSON.stringify(input.constraints ?? {})}`,
  ].join('\n\n');

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: AbortSignal.timeout(maxSeconds * 1000),
    });
    if (!response.ok) {
      const code = response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_ERROR';
      return respond(res, 200, protocolError(requestId, code, `Gemini request failed (HTTP ${response.status}).`));
    }

    const data = await response.json();
    let content = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (typeof content !== 'string' || !content) {
      return respond(res, 200, protocolError(requestId, 'INVALID_PROVIDER_RESPONSE', 'Gemini returned no solution text.'));
    }
    content = content.replace(/^```[\w+-]*\s*\n/, '').replace(/\n```\s*$/, '').trim();
    if (!content || Buffer.byteLength(content) > maxOutputBytes) {
      return respond(res, 200, protocolError(requestId, 'INVALID_PROVIDER_RESPONSE', 'Gemini returned an empty or oversized solution.'));
    }

    const usage = data.usageMetadata || {};
    const tokens = value => Number.isInteger(value) && value > 0 ? value : null;
    const fileExtension = ({ python: 'py', javascript: 'js', typescript: 'ts', java: 'java', go: 'go', rust: 'rs', sql: 'sql' })[task.language.toLowerCase()] || 'txt';
    return respond(res, 200, {
      protocolVersion: '1.0', requestId, status: 'completed',
      result: { content, files: { [`solution.${fileExtension}`]: content } },
      metrics: { durationMs: Date.now() - started, inputTokens: tokens(usage.promptTokenCount), outputTokens: tokens(usage.candidatesTokenCount) },
      error: null, metadata: { provider: 'google', model, strategy: route.strategy },
    });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return respond(res, 200, protocolError(requestId, timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', timeout ? 'Gemini request timed out.' : 'Could not reach Gemini.'));
  }
});

server.listen(port, '0.0.0.0', () => console.log(`AgentArena sample agent listening on port ${port}`));
