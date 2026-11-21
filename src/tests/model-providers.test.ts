import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { AnthropicAdapter, DeepSeekAdapter, GeminiAdapter, ModelProviderError, OpenAIAdapter, withModelConcurrency } from '../server/model-providers';
import { decryptSecret, encryptSecret } from '../server/crypto';

async function main() {
  const original = globalThis.fetch;
  const adapters = [new GeminiAdapter(), new OpenAIAdapter(), new AnthropicAdapter(), new DeepSeekAdapter()];
  try {
    const previousKey = process.env.AGENTARENA_SECRET_KEY;
    process.env.AGENTARENA_SECRET_KEY = randomBytes(32).toString('hex');
    const encrypted = encryptSecret('provider-test-key');
    assert.notEqual(encrypted.encryptedData, 'provider-test-key');
    assert.equal(decryptSecret(encrypted), 'provider-test-key');
    assert.throws(() => decryptSecret({ ...encrypted, tag: '00'.repeat(16) }));
    if (previousKey === undefined) delete process.env.AGENTARENA_SECRET_KEY; else process.env.AGENTARENA_SECRET_KEY = previousKey;
    console.log('PASS provider key encryption, decryption, and authenticated-integrity check');
    for (const adapter of adapters) {
      let requestUrl = '';
      let requestHeaders = new Headers();
      globalThis.fetch = async (input, init) => {
        requestUrl = String(input); requestHeaders = new Headers(init?.headers);
        if (requestUrl.includes('/models') && init?.method !== 'POST') {
          return new Response(JSON.stringify(adapter.provider === 'GEMINI'
            ? { models: [{ name: 'models/model-test', displayName: 'Model Test', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-test', supportedGenerationMethods: ['embedContent'] }] }
            : { data: [{ id: 'model-test' }] }), { status: 200 });
        }
        if (adapter.provider === 'GEMINI') return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } }), { status: 200 });
        if (adapter.provider === 'ANTHROPIC') return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 4, output_tokens: 2 } }), { status: 200 });
        if (adapter.provider === 'OPENAI') return new Response(JSON.stringify({ output_text: 'ok', usage: { input_tokens: 4, output_tokens: 2 } }), { status: 200 });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } }), { status: 200 });
      };
      const models = await adapter.listModels('test-key-never-logged');
      assert.deepEqual(models.map(model => model.id), ['model-test']);
      assert.match(requestUrl, /models/);
      const result = await adapter.execute('test-key-never-logged', 'model-test', 'prompt', 1000);
      assert.equal(result.content, 'ok');
      assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 2 });
      if (adapter.provider === 'GEMINI') assert.equal(requestHeaders.get('x-goog-api-key'), 'test-key-never-logged');
      else if (adapter.provider === 'ANTHROPIC') assert.equal(requestHeaders.get('x-api-key'), 'test-key-never-logged');
      else assert.equal(requestHeaders.get('authorization'), 'Bearer test-key-never-logged');
      console.log(`PASS ${adapter.provider} model listing, auth format, response normalization, and token usage`);
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'private provider detail' } }), { status: 401 });
    await assert.rejects(() => new OpenAIAdapter().listModels('hidden-key'), error => error instanceof ModelProviderError && error.statusCode === 401 && !error.message.includes('private provider detail'));
    for (const adapter of adapters) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'private unsupported model detail' } }), { status: 404 });
      await assert.rejects(() => adapter.execute('hidden-key', 'unsupported-model', 'prompt', 1000), error => error instanceof ModelProviderError && error.statusCode === 404 && error.message.includes('selected model') && !error.message.includes('private'));
    }
    globalThis.fetch = async () => new Response('not-json', { status: 200 });
    await assert.rejects(() => new DeepSeekAdapter().listModels('hidden-key'), error => error instanceof ModelProviderError && /malformed/i.test(error.message));
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    await assert.rejects(() => new GeminiAdapter().execute('hidden-key', 'm', 'p', 5), error => error instanceof ModelProviderError && error.statusCode === 504);
    let attempts = 0;
    globalThis.fetch = async () => ++attempts === 1 ? new Response('{}', { status: 429 }) : new Response(JSON.stringify({ data: [{ id: 'recovered' }] }), { status: 200 });
    assert.equal((await new OpenAIAdapter().listModels('hidden-key'))[0].id, 'recovered');
    assert.equal(attempts, 2, '429 recovery must make only one bounded retry');
    let active = 0, peak = 0;
    await Promise.all(Array.from({ length: 8 }, () => withModelConcurrency(async () => {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--;
    })));
    assert.ok(peak <= 3, `model request concurrency was ${peak}`);
    console.log('PASS provider auth failure, unsupported models, malformed response, timeout handling, rate-limit retry, and secret-safe errors');
  } finally { globalThis.fetch = original; }
}
main().catch(error => { console.error('Model provider tests failed:', error.message); process.exitCode = 1; });
