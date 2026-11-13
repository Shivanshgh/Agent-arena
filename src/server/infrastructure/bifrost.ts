export interface BifrostRequest {
  provider: 'openai' | 'anthropic' | 'deepseek' | 'google' | 'custom';
  model: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
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
  private static endpoint = process.env.BIFROST_ENDPOINT || null;
  private static apiKey = process.env.BIFROST_API_KEY || null;

  private static validEndpoint(): string | null {
    if (!this.endpoint) return null;
    try {
      const parsed = new URL(this.endpoint);
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
    const isConfigured = Boolean(endpoint && this.apiKey);

    return {
      status: isConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      endpoint,
      supportedProviders: ['openai', 'anthropic', 'deepseek', 'google', 'custom'],
      hasApiKey: Boolean(this.apiKey),
    };
  }

  /**
   * Dispatches a prompt to a target LLM provider through the unified Bifrost Gateway
   */
  static async queryModel(request: BifrostRequest): Promise<BifrostResponse> {
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
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
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

      const data = await res.json();
      clearTimeout(timer);
      return {
        success: true,
        content: data.choices?.[0]?.message?.content || '',
        provider: request.provider,
        model: request.model,
        durationMs,
        tokens: {
          inputTokens: data.usage?.prompt_tokens ?? null,
          outputTokens: data.usage?.completion_tokens ?? null,
        },
      };
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err.name === 'AbortError';
      return {
        success: false,
        content: '',
        provider: request.provider,
        model: request.model,
        durationMs: Math.round(performance.now() - start),
        tokens: { inputTokens: null, outputTokens: null },
        errorMessage: isTimeout ? 'Bifrost gateway timeout after 30000ms' : `Gateway connection failure: ${err.message}`,
      };
    }
  }
}
