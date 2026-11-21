import { readLimitedResponse } from './limited-response';

export type ModelProviderId = 'GEMINI' | 'OPENAI' | 'ANTHROPIC' | 'DEEPSEEK';
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface ModelUsage { inputTokens: number | null; outputTokens: number | null; }
export interface ModelResult { content: string; usage: ModelUsage; provider: ModelProviderId; modelId: string; durationMs: number; }
export interface ModelInfo { id: string; displayName: string; }

export class ModelProviderError extends Error {
  constructor(message: string, readonly statusCode: number, readonly retryable: boolean = false) {
    super(message);
    this.name = 'ModelProviderError';
  }
}

const PROVIDER_URLS: Record<ModelProviderId, string> = {
  GEMINI: 'https://generativelanguage.googleapis.com/v1beta',
  OPENAI: 'https://api.openai.com/v1',
  ANTHROPIC: 'https://api.anthropic.com/v1',
  DEEPSEEK: 'https://api.deepseek.com',
};

function providerBaseUrl(provider: ModelProviderId): string {
  const override = process.env.AGENTARENA_TEST_PROVIDER_BASE_URL;
  if (process.env.NODE_ENV !== 'production' && process.env.AGENTARENA_ALLOW_LOCAL_PROVIDER_FIXTURE === 'true' && override) {
    try {
      const url = new URL(override);
      if (url.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname) && !url.username && !url.password) return url.toString().replace(/\/$/, '');
    } catch { /* use the fixed official provider URL */ }
  }
  return PROVIDER_URLS[provider];
}

function headers(provider: ModelProviderId, key: string): Record<string, string> {
  if (provider === 'GEMINI') return { 'content-type': 'application/json', 'x-goog-api-key': key };
  if (provider === 'ANTHROPIC') return { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  return { 'content-type': 'application/json', authorization: `Bearer ${key}` };
}

async function requestJson(provider: ModelProviderId, key: string, path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${providerBaseUrl(provider)}${path}`, {
      ...init, signal: controller.signal,
      headers: { ...headers(provider, key), ...(init.headers as Record<string, string> | undefined) },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const retryable = response.status === 429 || response.status >= 500;
      const message = response.status === 401 || response.status === 403 ? 'Provider rejected the API key.'
        : response.status === 404 ? 'The selected model or provider endpoint is unavailable.'
          : response.status === 429 ? 'Provider rate limit reached.' : `Provider request failed (${response.status}).`;
      throw new ModelProviderError(message, response.status, retryable);
    }
    const { text, exceeded } = await readLimitedResponse(response, MAX_PROVIDER_RESPONSE_BYTES);
    if (exceeded) throw new ModelProviderError('Provider response exceeded the size limit.', 502);
    try { return JSON.parse(text); }
    catch { throw new ModelProviderError('Provider returned malformed JSON.', 502); }
  } catch (error) {
    if (error instanceof ModelProviderError) throw error;
    if ((error as Error)?.name === 'AbortError') throw new ModelProviderError('Provider request timed out.', 504, true);
    throw new ModelProviderError('Provider could not be reached.', 502, true);
  } finally { clearTimeout(timer); }
}

async function requestWithRateLimitRetry(provider: ModelProviderId, key: string, path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<any> {
  try { return await requestJson(provider, key, path, init, timeoutMs); }
  catch (error) {
    if (!(error instanceof ModelProviderError) || error.statusCode !== 429) throw error;
    await new Promise(resolve => setTimeout(resolve, 500));
    return requestJson(provider, key, path, init, timeoutMs);
  }
}

export interface ModelAdapter {
  listModels(apiKey: string): Promise<ModelInfo[]>;
  execute(apiKey: string, modelId: string, prompt: string, timeoutMs: number): Promise<ModelResult>;
}

abstract class BaseAdapter implements ModelAdapter {
  abstract readonly provider: ModelProviderId;
  async listModels(apiKey: string): Promise<ModelInfo[]> {
    const path = this.provider === 'GEMINI' ? '/models' : '/models';
    const data = await requestWithRateLimitRetry(this.provider, apiKey, path);
    const rows: any[] = this.provider === 'GEMINI' ? data.models || [] : data.data || [];
    return rows.filter(row => {
      if (this.provider !== 'GEMINI') return typeof row.id === 'string';
      return row.supportedGenerationMethods?.includes('generateContent');
    }).map(row => {
      const id = String(row.name || row.id || '').replace(/^models\//, '');
      return { id, displayName: String(row.displayName || row.id || id) };
    }).filter(row => row.id).sort((a, b) => a.id.localeCompare(b.id));
  }

  async execute(apiKey: string, modelId: string, prompt: string, timeoutMs: number): Promise<ModelResult> {
    const startedAt = Date.now();
    let data: any;
    if (this.provider === 'GEMINI') {
      data = await requestWithRateLimitRetry(this.provider, apiKey, `/models/${encodeURIComponent(modelId)}:generateContent`, {
        method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 4096 } }),
      }, timeoutMs);
    } else if (this.provider === 'ANTHROPIC') {
      data = await requestWithRateLimitRetry(this.provider, apiKey, '/messages', {
        method: 'POST', body: JSON.stringify({ model: modelId, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
      }, timeoutMs);
    } else if (this.provider === 'OPENAI') {
      data = await requestWithRateLimitRetry(this.provider, apiKey, '/responses', {
        method: 'POST', body: JSON.stringify({ model: modelId, input: prompt, max_output_tokens: 4096, store: false }),
      }, timeoutMs);
    } else {
      data = await requestWithRateLimitRetry(this.provider, apiKey, '/chat/completions', {
        method: 'POST', body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 }),
      }, timeoutMs);
    }
    const content = this.provider === 'GEMINI' ? data.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('')
      : this.provider === 'ANTHROPIC' ? data.content?.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')
        : this.provider === 'OPENAI' ? data.output_text || data.output?.flatMap((item: any) => item.content || []).filter((part: any) => part.type === 'output_text').map((part: any) => part.text).join('')
          : data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new ModelProviderError('Provider returned an empty or invalid response.', 502);
    const usage = this.provider === 'GEMINI' ? data.usageMetadata : this.provider === 'ANTHROPIC' ? data.usage : data.usage;
    const inputTokens = usage?.promptTokenCount ?? usage?.input_tokens ?? usage?.prompt_tokens;
    const outputTokens = usage?.candidatesTokenCount ?? usage?.output_tokens ?? usage?.completion_tokens;
    return {
      content: content.slice(0, 100_000), provider: this.provider, modelId, durationMs: Date.now() - startedAt,
      usage: {
        inputTokens: Number.isInteger(inputTokens) && inputTokens > 0 ? inputTokens : null,
        outputTokens: Number.isInteger(outputTokens) && outputTokens > 0 ? outputTokens : null,
      },
    };
  }
}

export class GeminiAdapter extends BaseAdapter { readonly provider = 'GEMINI' as const; }
export class OpenAIAdapter extends BaseAdapter { readonly provider = 'OPENAI' as const; }
export class AnthropicAdapter extends BaseAdapter { readonly provider = 'ANTHROPIC' as const; }
export class DeepSeekAdapter extends BaseAdapter { readonly provider = 'DEEPSEEK' as const; }

export const modelAdapters: Record<ModelProviderId, ModelAdapter> = {
  GEMINI: new GeminiAdapter(), OPENAI: new OpenAIAdapter(),
  ANTHROPIC: new AnthropicAdapter(), DEEPSEEK: new DeepSeekAdapter(),
};

const MODEL_CONCURRENCY_LIMIT = 3;
let activeModelCalls = 0;
const modelCallQueue: Array<() => void> = [];
export async function withModelConcurrency<T>(operation: () => Promise<T>): Promise<T> {
  if (activeModelCalls >= MODEL_CONCURRENCY_LIMIT) await new Promise<void>(resolve => modelCallQueue.push(resolve));
  else activeModelCalls++;
  try { return await operation(); }
  finally {
    const next = modelCallQueue.shift();
    if (next) next();
    else activeModelCalls--;
  }
}

export function buildBenchmarkPrompt(task: { title: string; description: string; language: string; inputData: Record<string, unknown> }): string {
  return [
    'Complete the following benchmark task. Return only your answer or solution; do not claim tests passed unless you ran them.',
    `Title: ${task.title}`, `Language: ${task.language}`, `Instructions: ${task.description}`,
    `Input: ${JSON.stringify(task.inputData)}`,
  ].join('\n\n');
}
