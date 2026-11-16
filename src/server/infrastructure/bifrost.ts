export interface BifrostRequest {
  provider: 'openai' | 'anthropic' | 'deepseek' | 'google' | 'custom';
  model: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Internal bounded timeout override for tests; defaults to 30 seconds. */
  timeoutMs?: number;
}

export interface BifrostResponse {
  success: boolean;
  content: string;
  provider: string;
  model: string;
  durationMs: number;
  tokens: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
  errorMessage?: string;
}

export class BifrostGateway {
  private static validEndpoint(): string | null {
    const configured = process.env.BIFROST_ENDPOINT?.trim();
    if (!configured) return null;
    try {
      const parsed = new URL(configured);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
      return parsed.toString().replace(/\/$/, '');
    } catch { return null; }
  }

  /**
   * Returns gateway status and provider configuration without exposing credentials
   */
  static getStatus(): {
    status: 'CONFIGURED' | 'NOT_CONFIGURED';
    endpoint: string | null;
    supportedProviders: string[];
    hasApiKey: boolean;
  } {
    const endpoint = this.validEndpoint();
    const isConfigured = Boolean(endpoint && process.env.BIFROST_API_KEY?.trim());

    return {
      status: isConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      endpoint,
      supportedProviders: ['openai', 'anthropic', 'deepseek', 'google', 'custom'],
      hasApiKey: Boolean(process.env.BIFROST_API_KEY?.trim()),
    };
  }

  /**
   * Dispatches a prompt to a target LLM provider through the unified Bifrost Gateway
   */
  static async queryModel(request: BifrostRequest): Promise<BifrostResponse> {
    const providers = ['openai', 'anthropic', 'deepseek', 'google', 'custom'];
    if (!request || !providers.includes(request.provider) || typeof request.model !== 'string' || !request.model.trim() || request.model.length > 200 ||
        typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 100_000 ||
        (request.maxTokens !== undefined && (!Number.isInteger(request.maxTokens) || request.maxTokens < 1 || request.maxTokens > 8192)) ||
        (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) ||
        (request.timeoutMs !== undefined && (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 30_000))) {
      return { success: false, content: '', provider: request?.provider || 'custom', model: request?.model || '', durationMs: 0, tokens: { inputTokens: null, outputTokens: null }, errorMessage: 'Invalid Bifrost request.' };
    }
    const status = this.getStatus();
    if (status.status === 'NOT_CONFIGURED') {
      return {
        success: false,
        content: '',
        provider: request.provider,
        model: request.model,
        durationMs: 0,
        tokens: { inputTokens: null, outputTokens: null },
        errorMessage: 'Bifrost Gateway is not configured. Set BIFROST_ENDPOINT and BIFROST_API_KEY in environment.',
      };
    }

    const endpoint = this.validEndpoint();
    if (!endpoint) return { success: false, content: '', provider: request.provider, model: request.model, durationMs: 0, tokens: { inputTokens: null, outputTokens: null }, errorMessage: 'Bifrost endpoint must be a valid HTTP(S) URL without embedded credentials, query, or fragment.' };
    const start = performance.now();
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.BIFROST_API_KEY}`,
          'X-Bifrost-Provider': request.provider,
        },
        body: JSON.stringify({
          model: request.model,
          messages: [{ role: 'user', content: request.prompt }],
          max_tokens: request.maxTokens || 2048,
          temperature: request.temperature ?? 0.2,
        }),
        signal: controller.signal,
      });

      const durationMs = Math.round(performance.now() - start);

      if (!res.ok) {
        await res.text();
        clearTimeout(timer);
        return {
          success: false,
          content: '',
          provider: request.provider,
          model: request.model,
          durationMs,
          tokens: { inputTokens: null, outputTokens: null },
          errorMessage: `Bifrost provider returned HTTP ${res.status}.`,
        };
      }

      const payload = await res.text();
      clearTimeout(timer);
      if (payload.length > 2_000_000) return { success: false, content: '', provider: request.provider, model: request.model, durationMs: Math.round(performance.now() - start), tokens: { inputTokens: null, outputTokens: null }, errorMessage: 'Bifrost response exceeded the size limit.' };
      let data: any;
      try { data = JSON.parse(payload); } catch {
        return { success: false, content: '', provider: request.provider, model: request.model, durationMs: Math.round(performance.now() - start), tokens: { inputTokens: null, outputTokens: null }, errorMessage: 'Bifrost returned an invalid response.' };
      }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return { success: false, content: '', provider: request.provider, model: request.model, durationMs: Math.round(performance.now() - start), tokens: { inputTokens: null, outputTokens: null }, errorMessage: 'Bifrost response did not match the chat completion format.' };
      const tokenCount = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
      return {
        success: true,
        content,
        provider: request.provider,
        model: request.model,
        durationMs,
        tokens: {
          inputTokens: tokenCount(data.usage?.prompt_tokens),
          outputTokens: tokenCount(data.usage?.completion_tokens),
        },
      };
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = controller.signal.aborted || err?.name === 'AbortError';
      return {
        success: false,
        content: '',
        provider: request.provider,
        model: request.model,
        durationMs: Math.round(performance.now() - start),
        tokens: { inputTokens: null, outputTokens: null },
        errorMessage: isTimeout ? `Bifrost gateway timeout after ${timeoutMs}ms` : 'Bifrost gateway request failed.',
      };
    }
  }
}
