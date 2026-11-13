import {
  AgentHealthResponse,
  AgentHealthResponseSchema,
  StandardizedAgentRequest,
  StandardizedAgentRequestSchema,
  StandardizedAgentResponse,
  StandardizedAgentResponseSchema,
} from '../types/agent';
import { validateEndpointForSsrf } from './ssrf';

export interface HttpAdapterAuth {
  type: 'NONE' | 'BEARER' | 'API_KEY' | 'CUSTOM_HEADER';
  headerName?: string;
  secret?: string;
}

export interface HttpAdapterOptions {
  timeoutMs?: number;
  maxResponseSizeBytes?: number;
  allowLocal?: boolean;
}

export interface AdapterHealthCheckResult {
  success: boolean;
  statusCode?: number;
  latencyMs: number;
  resolvedIp?: string;
  healthPayload?: AgentHealthResponse | null;
  errorMessage?: string;
  rawResponse?: string;
}

export interface AdapterExecutionResult {
  success: boolean;
  statusCode?: number;
  durationMs: number;
  response: StandardizedAgentResponse | null;
  errorMessage?: string;
}

export class AgentHttpAdapter {
  private endpoint: string;
  private auth: HttpAdapterAuth;
  private defaultTimeoutMs: number;
  private maxResponseSizeBytes: number;
  private allowLocal: boolean;

  constructor(
    endpoint: string,
    auth: HttpAdapterAuth = { type: 'NONE' },
    options: HttpAdapterOptions = {}
  ) {
    // Strip trailing slashes
    this.endpoint = endpoint.replace(/\/+$/, '');
    this.auth = auth;
    this.defaultTimeoutMs = options.timeoutMs ?? 30_000;
    this.maxResponseSizeBytes = options.maxResponseSizeBytes ?? 1_000_000; // 1MB default
    this.allowLocal = options.allowLocal ?? (process.env.ALLOW_LOCAL_TEST_AGENTS === 'true' || process.env.NODE_ENV !== 'production');
  }

  /**
   * Prepares authorization headers
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'AgentArena-Harness/1.0',
    };

    if (this.auth.secret) {
      switch (this.auth.type) {
        case 'BEARER':
          headers['Authorization'] = `Bearer ${this.auth.secret}`;
          break;
        case 'API_KEY':
          headers[this.auth.headerName || 'X-API-Key'] = this.auth.secret;
          break;
        case 'CUSTOM_HEADER':
          if (this.auth.headerName) {
            headers[this.auth.headerName] = this.auth.secret;
          }
          break;
        case 'NONE':
        default:
          break;
      }
    }

    return headers;
  }

  /**
   * Resolves a sub-path preserving any query parameters in endpoint
   */
  public resolveUrl(subPath: string): string {
    try {
      const url = new URL(this.endpoint);
      const cleanSubPath = subPath.startsWith('/') ? subPath : `/${subPath}`;
      const baseClean = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
      url.pathname = `${baseClean}${cleanSubPath}`;
      return url.toString();
    } catch {
      return `${this.endpoint}${subPath.startsWith('/') ? subPath : `/${subPath}`}`;
    }
  }

  /**
   * Validates health endpoint of an agent
   * Targets GET ${endpoint}/health
   */
  async checkHealth(): Promise<AdapterHealthCheckResult> {
    const healthUrl = this.resolveUrl('/health');
    const start = performance.now();

    // 1. SSRF check
    const ssrf = await validateEndpointForSsrf(healthUrl, { allowLocal: this.allowLocal });
    if (!ssrf.valid) {
      return {
        success: false,
        latencyMs: Math.round(performance.now() - start),
        errorMessage: `SSRF validation failed: ${ssrf.reason}`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000); // 10s health check timeout

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal,
        redirect: 'error', // Protect against redirect-based SSRF bypass
      });

      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - start);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          statusCode: response.status,
          latencyMs,
          resolvedIp: ssrf.resolvedIp,
          errorMessage: `Health check failed with HTTP ${response.status}: ${errorText.slice(0, 200)}`,
        };
      }

      const text = await response.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        return {
          success: false,
          statusCode: response.status,
          latencyMs,
          resolvedIp: ssrf.resolvedIp,
          errorMessage: 'Health endpoint returned invalid JSON',
          rawResponse: text.slice(0, 300),
        };
      }

      // Validate health schema
      const parsed = AgentHealthResponseSchema.safeParse(json);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: response.status,
          latencyMs,
          resolvedIp: ssrf.resolvedIp,
          errorMessage: `Health response did not meet schema: ${parsed.error.issues.map(i => i.message).join(', ')}`,
          rawResponse: text.slice(0, 300),
        };
      }

      return {
        success: true,
        statusCode: response.status,
        latencyMs,
        resolvedIp: ssrf.resolvedIp,
        healthPayload: parsed.data,
      };
    } catch (err: any) {
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - start);
      const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');

      return {
        success: false,
        latencyMs,
        resolvedIp: ssrf.resolvedIp,
        errorMessage: isTimeout
          ? 'Health check timed out after 10,000ms'
          : `Connection error: ${err.message}`,
      };
    }
  }

  /**
   * Executes a standardized task against the agent
   * Targets POST ${endpoint}/execute or POST ${endpoint}
   */
  async executeTask(
    request: StandardizedAgentRequest,
    options: { path?: string; timeoutSeconds?: number } = {}
  ): Promise<AdapterExecutionResult> {
    // Validate request schema before transmission
    const validatedRequest = StandardizedAgentRequestSchema.safeParse(request);
    if (!validatedRequest.success) {
      return {
        success: false,
        durationMs: 0,
        response: null,
        errorMessage: `Invalid request payload: ${validatedRequest.error.issues.map(i => i.message).join(', ')}`,
      };
    }

    const subPath = options.path || '/execute';
    const targetUrl = this.resolveUrl(subPath);
    const start = performance.now();

    // SSRF Check
    const ssrf = await validateEndpointForSsrf(targetUrl, { allowLocal: this.allowLocal });
    if (!ssrf.valid) {
      return {
        success: false,
        durationMs: Math.round(performance.now() - start),
        response: null,
        errorMessage: `SSRF validation failed: ${ssrf.reason}`,
      };
    }

    const timeoutMs = (options.timeoutSeconds ?? request.constraints.timeoutSeconds ?? 120) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(validatedRequest.data),
        signal: controller.signal,
        redirect: 'error',
      });

      clearTimeout(timer);
      const durationMs = Math.round(performance.now() - start);

      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > this.maxResponseSizeBytes) {
        return {
          success: false,
          statusCode: response.status,
          durationMs,
          response: null,
          errorMessage: `Response size exceeds limit of ${this.maxResponseSizeBytes} bytes`,
        };
      }

      const text = await response.text();
      if (text.length > this.maxResponseSizeBytes) {
        return {
          success: false,
          statusCode: response.status,
          durationMs,
          response: null,
          errorMessage: `Response payload exceeds limit of ${this.maxResponseSizeBytes} bytes`,
        };
      }

      if (!response.ok) {
        return {
          success: false,
          statusCode: response.status,
          durationMs,
          response: null,
          errorMessage: `Agent returned HTTP error ${response.status}: ${text.slice(0, 200)}`,
        };
      }

      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        return {
          success: false,
          statusCode: response.status,
          durationMs,
          response: null,
          errorMessage: 'Agent returned malformed JSON response',
        };
      }

      // Validate against standardized protocol schema
      const parsed = StandardizedAgentResponseSchema.safeParse(json);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: response.status,
          durationMs,
          response: null,
          errorMessage: `Agent response does not conform to protocol v1.0: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        };
      }

      // Ensure durationMs reflects actual measured duration if not reported by agent
      const validatedData = parsed.data;
      if (!validatedData.metrics.durationMs) {
        validatedData.metrics.durationMs = durationMs;
      }

      return {
        success: validatedData.status === 'completed',
        statusCode: response.status,
        durationMs,
        response: validatedData,
      };
    } catch (err: any) {
      clearTimeout(timer);
      const durationMs = Math.round(performance.now() - start);
      const isTimeout =
        err.name === 'AbortError' ||
        err.name === 'TimeoutError' ||
        err.code === 'ABORT_ERR' ||
        /abort|timeout/i.test(err.message || '') ||
        /abort|timeout/i.test(err.cause?.message || '') ||
        /abort|timeout/i.test(err.cause?.name || '');

      if (isTimeout) {
        return {
          success: false,
          durationMs,
          response: {
            protocolVersion: '1.0',
            requestId: request.requestId,
            status: 'timed_out',
            result: null,
            metrics: {
              durationMs,
              inputTokens: null,
              outputTokens: null,
            },
            error: {
              code: 'TIMEOUT',
              message: `Execution timed out after ${timeoutMs}ms`,
            },
            metadata: {},
          },
          errorMessage: `Request timed out after ${timeoutMs}ms`,
        };
      }

      return {
        success: false,
        durationMs,
        response: null,
        errorMessage: `Connection failed: ${err.message}`,
      };
    }
  }
}
