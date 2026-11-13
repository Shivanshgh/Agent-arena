import http from 'http';
import assert from 'assert';
import { agentDb } from '../server/db';
import { encryptSecret, decryptSecret, redactSecret } from '../server/crypto';
import { validateEndpointForSsrf, isPrivateOrReservedIPv4 } from '../server/ssrf';
import { AgentHttpAdapter } from '../server/http-adapter';
import { StandardizedAgentRequest, StandardizedAgentResponseSchema } from '../types/agent';

async function runStage3Tests() {
  console.log('\n======================================================');
  console.log('  AgentArena — STAGE 3 Comprehensive Verification Suite');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      process.stdout.write(`• Testing: ${name} ... `);
      await fn();
      console.log('✓ PASS');
      passed++;
    } catch (err: any) {
      console.log('✗ FAIL');
      console.error(`  Error: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(0, 3).join('\n'));
      failed++;
    }
  }

  // ---------------------------------------------------------
  // 1. SSRF & Endpoint Protection Tests
  // ---------------------------------------------------------
  await test('SSRF: Detects and blocks private IPv4 ranges (RFC 1918 & 3927)', async () => {
    assert.strictEqual(isPrivateOrReservedIPv4('127.0.0.1'), true);
    assert.strictEqual(isPrivateOrReservedIPv4('10.0.0.15'), true);
    assert.strictEqual(isPrivateOrReservedIPv4('172.16.5.2'), true);
    assert.strictEqual(isPrivateOrReservedIPv4('192.168.1.1'), true);
    assert.strictEqual(isPrivateOrReservedIPv4('169.254.169.254'), true);
    assert.strictEqual(isPrivateOrReservedIPv4('8.8.8.8'), false);
    assert.strictEqual(isPrivateOrReservedIPv4('1.1.1.1'), false);
  });

  await test('SSRF: Blocks cloud metadata hostnames and localhost', async () => {
    const metaCheck = await validateEndpointForSsrf('http://169.254.169.254/latest/meta-data/', { allowLocal: false });
    assert.strictEqual(metaCheck.valid, false);
    assert(metaCheck.reason?.includes('metadata') || metaCheck.reason?.includes('blocked'));

    const googleMeta = await validateEndpointForSsrf('http://metadata.google.internal/computeMetadata/v1/', { allowLocal: false });
    assert.strictEqual(googleMeta.valid, false);

    const localhostCheck = await validateEndpointForSsrf('http://localhost:8080/health', { allowLocal: false });
    assert.strictEqual(localhostCheck.valid, false);
  });

  await test('SSRF: Rejects non-HTTP/HTTPS protocols (ftp, file, gopher)', async () => {
    const fileRes = await validateEndpointForSsrf('file:///etc/passwd');
    assert.strictEqual(fileRes.valid, false);

    const ftpRes = await validateEndpointForSsrf('ftp://1.1.1.1/script.sh');
    assert.strictEqual(ftpRes.valid, false);
  });

  // ---------------------------------------------------------
  // 2. Encryption & Credential Security Tests
  // ---------------------------------------------------------
  await test('Crypto: AES-256-GCM correctly encrypts and decrypts secrets', async () => {
    const sampleToken = 'sk_live_agentarena_secret_token_12345';
    const encrypted = encryptSecret(sampleToken);
    
    assert(encrypted.encryptedData !== sampleToken, 'Encrypted data must not match plaintext');
    assert(encrypted.iv && encrypted.iv.length === 24, 'IV must be 12-byte hex (24 chars)');
    assert(encrypted.tag && encrypted.tag.length === 32, 'Tag must be 16-byte hex (32 chars)');

    const decrypted = decryptSecret(encrypted);
    assert.strictEqual(decrypted, sampleToken, 'Decrypted secret must match original');
  });

  await test('Security: Credential redaction masks tokens properly', async () => {
    const redacted = redactSecret('secret_token_abc123');
    assert.strictEqual(redacted, 'sec••••23');
    assert(!redacted.includes('token'), 'Must not reveal sensitive middle characters');
  });

  // ---------------------------------------------------------
  // 3. Agent Database CRUD & Redaction
  // ---------------------------------------------------------
  let createdAgentId = '';

  await test('Registry: Registers new agent with encrypted credentials', async () => {
    const newAgent = agentDb.create({
      name: 'Verification Test Agent',
      description: 'Temporary agent created for unit test verification',
      version: '1.0.0',
      integrationType: 'HTTP',
      endpoint: 'https://test-agent.example.com',
      supportedLanguages: ['typescript', 'python'],
      supportedCapabilities: ['code_generation'],
      authType: 'BEARER',
      authSecret: 'super-secret-auth-key-8899',
    });

    assert(newAgent.id, 'Agent must have generated ID');
    assert.strictEqual(newAgent.name, 'Verification Test Agent');
    assert.strictEqual(newAgent.hasAuthSecret, true);
    assert(!('authSecret' in newAgent), 'Sanitized agent MUST NEVER include authSecret');
    assert(!('encryptedAuthSecret' in newAgent), 'Sanitized agent MUST NOT expose raw encrypted secret');

    createdAgentId = newAgent.id;
  });

  await test('Registry: Retrieves agent by ID and ensures secret is hidden', async () => {
    const agent = agentDb.get(createdAgentId);
    assert(agent !== null, 'Agent must exist');
    assert.strictEqual(agent?.hasAuthSecret, true);
    assert(!('authSecret' in (agent as any)));
  });

  await test('Registry: Updates agent metadata without leaking credentials', async () => {
    const updated = agentDb.update(createdAgentId, {
      description: 'Updated test description',
      version: '1.1.0',
    });

    assert.strictEqual(updated?.description, 'Updated test description');
    assert.strictEqual(updated?.version, '1.1.0');
    assert.strictEqual(updated?.hasAuthSecret, true);
  });

  await test('Registry: Deletes registered agent cleanly', async () => {
    const deleteResult = agentDb.delete(createdAgentId);
    assert.strictEqual(deleteResult, true);

    const verifyNotFound = agentDb.get(createdAgentId);
    assert.strictEqual(verifyNotFound, null);
  });

  // ---------------------------------------------------------
  // 4. Local Test Fixture Server (Testing HTTP Adapter)
  // ---------------------------------------------------------
  let fixtureServer: http.Server;
  let fixturePort: number = 0;

  await test('Fixture Server: Initializes local mock agent fixture', async () => {
    await new Promise<void>((resolve, reject) => {
      fixtureServer = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://127.0.0.1`);

        // Auth verification
        if (url.searchParams.get('auth') === 'required') {
          const auth = req.headers['authorization'];
          if (!auth || !auth.includes('test-bearer-token')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Unauthorized' }));
          }
        }

        if (url.pathname === '/health') {
          if (url.searchParams.get('mode') === '500') {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Internal crash' }));
          }
          if (url.searchParams.get('mode') === 'malformed') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return res.end('MALFORMED_NON_JSON_RESPONSE');
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            status: 'healthy',
            version: '1.0.0',
            protocolVersion: '1.0',
            capabilities: ['code_generation'],
          }));
        }

        if (url.pathname === '/execute') {
          if (url.searchParams.get('mode') === 'hang') {
            // Keep request hanging for timeout test
            return;
          }

          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            const data = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              protocolVersion: '1.0',
              requestId: data.requestId,
              status: 'completed',
              result: {
                content: 'console.log("Hello from test fixture agent");',
              },
              metrics: {
                durationMs: 45,
                inputTokens: 30,
                outputTokens: 55,
              },
              error: null,
              metadata: {},
            }));
          });
          return;
        }

        res.writeHead(404);
        res.end();
      });

      fixtureServer.listen(0, '127.0.0.1', () => {
        const addr = fixtureServer.address() as any;
        fixturePort = addr.port;
        resolve();
      });
    });

    assert(fixturePort > 0, 'Server must bind to dynamic test port');
  });

  await test('HTTP Adapter: Successful health check against fixture', async () => {
    const adapter = new AgentHttpAdapter(`http://127.0.0.1:${fixturePort}`, { type: 'NONE' }, { allowLocal: true });
    const health = await adapter.checkHealth();

    assert.strictEqual(health.success, true);
    assert.strictEqual(health.statusCode, 200);
    assert.strictEqual(health.healthPayload?.status, 'healthy');
    assert.strictEqual(health.healthPayload?.protocolVersion, '1.0');
    assert(health.latencyMs >= 0);
  });

  await test('HTTP Adapter: Injects Bearer token authorization correctly', async () => {
    const authedAdapter = new AgentHttpAdapter(
      `http://127.0.0.1:${fixturePort}?auth=required`,
      { type: 'BEARER', secret: 'test-bearer-token' },
      { allowLocal: true }
    );
    const health = await authedAdapter.checkHealth();
    assert.strictEqual(health.success, true);

    const badAuthAdapter = new AgentHttpAdapter(
      `http://127.0.0.1:${fixturePort}?auth=required`,
      { type: 'BEARER', secret: 'wrong-token' },
      { allowLocal: true }
    );
    const badHealth = await badAuthAdapter.checkHealth();
    assert.strictEqual(badHealth.success, false);
    assert.strictEqual(badHealth.statusCode, 401);
  });

  await test('HTTP Adapter: Handles agent 500 error gracefully', async () => {
    const adapter = new AgentHttpAdapter(`http://127.0.0.1:${fixturePort}?mode=500`, { type: 'NONE' }, { allowLocal: true });
    const health = await adapter.checkHealth();

    assert.strictEqual(health.success, false);
    assert.strictEqual(health.statusCode, 500);
    assert(health.errorMessage?.includes('HTTP 500'));
  });

  await test('HTTP Adapter: Rejects malformed JSON from agent', async () => {
    const adapter = new AgentHttpAdapter(`http://127.0.0.1:${fixturePort}?mode=malformed`, { type: 'NONE' }, { allowLocal: true });
    const health = await adapter.checkHealth();

    assert.strictEqual(health.success, false);
    assert(health.errorMessage?.includes('invalid JSON'));
  });

  await test('HTTP Adapter: Executes standardized task and validates protocol v1.0 response', async () => {
    const adapter = new AgentHttpAdapter(`http://127.0.0.1:${fixturePort}`, { type: 'NONE' }, { allowLocal: true });
    const taskRequest: StandardizedAgentRequest = {
      protocolVersion: '1.0',
      requestId: 'test-req-001',
      task: {
        taskId: 'task-reverse-01',
        title: 'Reverse string',
        description: 'Implement string reverser',
        language: 'typescript',
        input: {},
      },
      constraints: {
        timeoutSeconds: 10,
        maxOutputSizeBytes: 50_000,
      },
    };

    const execResult = await adapter.executeTask(taskRequest);
    assert.strictEqual(execResult.success, true);
    assert.strictEqual(execResult.response?.status, 'completed');
    assert.strictEqual(execResult.response?.protocolVersion, '1.0');
    assert(execResult.response?.result?.content.includes('Hello from test fixture'));
    assert.strictEqual(execResult.response?.metrics.inputTokens, 30);
    assert.strictEqual(execResult.response?.metrics.outputTokens, 55);
  });

  await test('HTTP Adapter: Enforces request timeout on unresponsive agents', async () => {
    const adapter = new AgentHttpAdapter(`http://127.0.0.1:${fixturePort}?mode=hang`, { type: 'NONE' }, { allowLocal: true });
    const taskRequest: StandardizedAgentRequest = {
      protocolVersion: '1.0',
      requestId: 'test-req-timeout',
      task: {
        taskId: 'task-timeout-01',
        title: 'Timeout task',
        description: 'Should abort when hung',
        language: 'python',
        input: {},
      },
      constraints: {
        timeoutSeconds: 1, // 1 second timeout
        maxOutputSizeBytes: 50_000,
      },
    };

    const execResult = await adapter.executeTask(taskRequest, { timeoutSeconds: 1 });
    assert.strictEqual(execResult.success, false);
    assert.strictEqual(execResult.response?.status, 'timed_out');
    assert(execResult.errorMessage?.includes('timed out'));
  });

  // Clean up fixture server
  await new Promise<void>(resolve => fixtureServer.close(() => resolve()));

  console.log('\n------------------------------------------------------');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage3Tests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
