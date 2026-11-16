import assert from 'node:assert/strict';
import { BifrostGateway } from '../server/infrastructure/bifrost';
import { reviewSemanticCorrectness, SemanticReviewError } from '../server/semantic-review';

const env = process.env;
const old = {
  endpoint: env.BIFROST_ENDPOINT, key: env.BIFROST_API_KEY,
  provider: env.BIFROST_EVALUATION_PROVIDER, model: env.BIFROST_EVALUATION_MODEL,
};
const originalFetch = globalThis.fetch;
let requests = 0;
let mode: 'valid' | 'provider-error' | 'invalid-envelope' | 'timeout' = 'valid';
const semantic = JSON.stringify({ score: 87, rationale: 'The solution follows the requested behavior.', evidence: ['return result'] });
const task = { title: 'Reverse text', description: 'Return the input string in reverse order.', language: 'python', inputData: { value: 'abc' }, expectedOutput: 'cba' } as any;
const execution = { status: 'COMPLETED', rawOutput: 'def reverse_string(value): return value[::-1]' } as any;

async function run() {
  try {
    delete env.BIFROST_ENDPOINT; delete env.BIFROST_API_KEY;
    assert.equal((await BifrostGateway.queryModel({ provider: 'openai', model: 'openai/test', prompt: 'test' })).success, false);

    env.BIFROST_ENDPOINT = 'https://bifrost.invalid/v1';
    env.BIFROST_API_KEY = 'test-only-secret';
    env.BIFROST_EVALUATION_PROVIDER = 'openai';
    env.BIFROST_EVALUATION_MODEL = 'openai/test-model';
    globalThis.fetch = (async (input: any, init: any) => {
      requests++;
      assert.equal(String(input), 'https://bifrost.invalid/v1/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer test-only-secret');
      const body = JSON.parse(init.body);
      assert.equal(body.model, mode === 'timeout' ? 'openai/test' : 'openai/test-model');
      if (mode === 'timeout') return await new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
      if (mode === 'provider-error') return new Response('provider error', { status: 503 });
      const content = mode === 'invalid-envelope' ? 'not-json' : semantic;
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }), { status: 200 });
    }) as typeof fetch;

    const before = requests;
    const review = await reviewSemanticCorrectness(task, execution);
    assert.equal(review.score, 87);
    assert.equal(review.provider, 'openai');
    assert.equal(requests, before + 1);

    mode = 'invalid-envelope';
    await assert.rejects(() => reviewSemanticCorrectness(task, execution), e => e instanceof SemanticReviewError && e.statusCode === 502);
    mode = 'provider-error';
    await assert.rejects(() => reviewSemanticCorrectness(task, execution), e => e instanceof SemanticReviewError && e.statusCode === 502);
    mode = 'timeout';
    const timed = await BifrostGateway.queryModel({ provider: 'openai', model: 'openai/test', prompt: 'test', timeoutMs: 15 });
    assert.equal(timed.success, false);
    assert.match(timed.errorMessage || '', /timeout/i);

    env.BIFROST_EVALUATION_MODEL = '';
    await assert.rejects(() => reviewSemanticCorrectness(task, execution), e => e instanceof SemanticReviewError && e.statusCode === 503);
    console.log('Bifrost semantic review tests: PASS (missing credentials/config, success, invalid response, provider error, timeout).');
  } finally {
    globalThis.fetch = originalFetch;
    if (old.endpoint === undefined) delete env.BIFROST_ENDPOINT; else env.BIFROST_ENDPOINT = old.endpoint;
    if (old.key === undefined) delete env.BIFROST_API_KEY; else env.BIFROST_API_KEY = old.key;
    if (old.provider === undefined) delete env.BIFROST_EVALUATION_PROVIDER; else env.BIFROST_EVALUATION_PROVIDER = old.provider;
    if (old.model === undefined) delete env.BIFROST_EVALUATION_MODEL; else env.BIFROST_EVALUATION_MODEL = old.model;
  }
}

run().catch(error => { console.error('Bifrost semantic review tests failed:', error.message); process.exitCode = 1; });
