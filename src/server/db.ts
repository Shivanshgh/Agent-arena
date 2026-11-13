import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Agent, AuthType, ConnectionStatus, IntegrationType, RegisterAgentInput, UpdateAgentInput, ConnectionTestResult } from '../types/agent';
import { encryptSecret, decryptSecret } from './crypto';

interface StoredAgentRecord {
  id: string;
  name: string;
  description: string;
  version: string;
  integrationType: IntegrationType;
  endpoint: string;
  supportedLanguages: string[];
  supportedCapabilities: string[];
  
  authType: AuthType;
  authHeaderName?: string;
  encryptedAuthSecret?: string;
  authSecretIv?: string;
  authSecretTag?: string;
  
  connectionStatus: ConnectionStatus;
  lastSuccessfulConnection: string | null;
  lastCheckedAt: string | null;
  lastErrorMessage: string | null;
  
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'agents.json');

// Memory cache of agents
let agentsCache: StoredAgentRecord[] = [];
let initialized = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function sanitizeAgent(record: StoredAgentRecord): Agent {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    integrationType: record.integrationType,
    endpoint: record.endpoint,
    supportedLanguages: record.supportedLanguages,
    supportedCapabilities: record.supportedCapabilities,
    authType: record.authType,
    authHeaderName: record.authHeaderName,
    hasAuthSecret: Boolean(record.encryptedAuthSecret),
    connectionStatus: record.connectionStatus,
    lastSuccessfulConnection: record.lastSuccessfulConnection,
    lastCheckedAt: record.lastCheckedAt,
    lastErrorMessage: record.lastErrorMessage,
    metadata: record.metadata || {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function saveToDisk() {
  ensureDataDir();
  const tempFile = `${DATA_FILE}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(agentsCache, null, 2), 'utf-8');
  fs.renameSync(tempFile, DATA_FILE);
}

function loadInitialData() {
  if (initialized) return;
  ensureDataDir();

  if (fs.existsSync(DATA_FILE)) {
    try {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      agentsCache = JSON.parse(content);
      initialized = true;
      return;
    } catch (err) {
      throw new Error(`agents.json exists but could not be parsed; refusing to overwrite existing data: ${String(err)}`);
    }
  }

  if (process.env.ENABLE_DEMO_SEED !== 'true' || process.env.NODE_ENV === 'production') {
    agentsCache = [];
    initialized = true;
    return;
  }

  // Seed default agents for testing and exploration
  const port = process.env.PORT || 3000;
  const mockAgentSecret = encryptSecret('arena_test_token_9f82bc');

  const seedAgents: StoredAgentRecord[] = [
    {
      id: 'agent-mock-builtin',
      name: 'AgentArena Reference Mock Agent',
      description: 'Standard built-in reference mock agent for validating protocol v1.0, health checks, and task execution.',
      version: '1.0.0',
      integrationType: 'HTTP',
      endpoint: `http://localhost:${port}/api/mock-agent`,
      supportedLanguages: ['typescript', 'javascript', 'python', 'rust', 'go'],
      supportedCapabilities: ['code_generation', 'code_refactoring', 'test_generation', 'debugging'],
      authType: 'BEARER',
      authHeaderName: 'Authorization',
      encryptedAuthSecret: mockAgentSecret.encryptedData,
      authSecretIv: mockAgentSecret.iv,
      authSecretTag: mockAgentSecret.tag,
      connectionStatus: 'CONNECTED',
      lastSuccessfulConnection: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
      lastErrorMessage: null,
      metadata: { author: 'AgentArena Team', benchmarkTier: 'Reference' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'agent-claude-coder',
      name: 'Anthropic Claude Code Adapter',
      description: 'Production agent wrapper executing complex multi-file coding and refactoring workflows.',
      version: '2.1.0',
      integrationType: 'HTTP',
      endpoint: 'https://claude-agent-adapter.arena.internal.net',
      supportedLanguages: ['python', 'typescript', 'go', 'java', 'c++'],
      supportedCapabilities: ['code_generation', 'multi_file_editing', 'test_generation', 'debugging'],
      authType: 'BEARER',
      authHeaderName: 'Authorization',
      encryptedAuthSecret: encryptSecret('sk_ant_sample_key_live_9921').encryptedData,
      authSecretIv: encryptSecret('sk_ant_sample_key_live_9921').iv,
      authSecretTag: encryptSecret('sk_ant_sample_key_live_9921').tag,
      connectionStatus: 'UNTESTED',
      lastSuccessfulConnection: null,
      lastCheckedAt: null,
      lastErrorMessage: null,
      metadata: { framework: 'Anthropic Agent SDK', model: 'claude-3-7-sonnet' },
      createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    },
    {
      id: 'agent-deepseek-r1',
      name: 'DeepSeek R1 Reasoning Agent',
      description: 'Autonomous algorithmic reasoning agent optimized for complex competitive programming and bug finding.',
      version: '1.2.0',
      integrationType: 'HTTP',
      endpoint: 'https://deepseek-coder.arena.internal.net',
      supportedLanguages: ['python', 'c++', 'rust', 'typescript'],
      supportedCapabilities: ['code_generation', 'debugging', 'algorithmic_solving'],
      authType: 'API_KEY',
      authHeaderName: 'X-DeepSeek-Key',
      encryptedAuthSecret: encryptSecret('dsk_live_arena_auth_8842').encryptedData,
      authSecretIv: encryptSecret('dsk_live_arena_auth_8842').iv,
      authSecretTag: encryptSecret('dsk_live_arena_auth_8842').tag,
      connectionStatus: 'UNTESTED',
      lastSuccessfulConnection: null,
      lastCheckedAt: null,
      lastErrorMessage: null,
      metadata: { framework: 'FastAPI / vLLM', model: 'deepseek-r1' },
      createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
    },
  ];

  agentsCache = seedAgents;
  saveToDisk();
  initialized = true;
}

export const agentDb = {
  list(): Agent[] {
    loadInitialData();
    return agentsCache.map(sanitizeAgent);
  },

  get(id: string): Agent | null {
    loadInitialData();
    const found = agentsCache.find(a => a.id === id);
    return found ? sanitizeAgent(found) : null;
  },

  getWithSecret(id: string): { agent: Agent; secret?: string } | null {
    loadInitialData();
    const found = agentsCache.find(a => a.id === id);
    if (!found) return null;

    let secret: string | undefined;
    if (found.encryptedAuthSecret && found.authSecretIv && found.authSecretTag) {
      try {
        secret = decryptSecret({
          encryptedData: found.encryptedAuthSecret,
          iv: found.authSecretIv,
          tag: found.authSecretTag,
        });
      } catch (err) {
        console.error(`Failed to decrypt secret for agent ${id}:`, err);
      }
    }

    return {
      agent: sanitizeAgent(found),
      secret,
    };
  },

  create(input: RegisterAgentInput): Agent {
    loadInitialData();

    const id = `agent-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    let encrypted: { encryptedData: string; iv: string; tag: string } | undefined;
    if (input.authSecret && input.authType !== 'NONE') {
      encrypted = encryptSecret(input.authSecret);
    }

    const record: StoredAgentRecord = {
      id,
      name: input.name,
      description: input.description || '',
      version: input.version || '1.0.0',
      integrationType: input.integrationType || 'HTTP',
      endpoint: input.endpoint,
      supportedLanguages: input.supportedLanguages,
      supportedCapabilities: input.supportedCapabilities || [],
      authType: input.authType || 'NONE',
      authHeaderName: input.authHeaderName,
      encryptedAuthSecret: encrypted?.encryptedData,
      authSecretIv: encrypted?.iv,
      authSecretTag: encrypted?.tag,
      connectionStatus: 'UNTESTED',
      lastSuccessfulConnection: null,
      lastCheckedAt: null,
      lastErrorMessage: null,
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    agentsCache.unshift(record);
    saveToDisk();

    return sanitizeAgent(record);
  },

  update(id: string, input: UpdateAgentInput): Agent | null {
    loadInitialData();
    const index = agentsCache.findIndex(a => a.id === id);
    if (index === -1) return null;

    const existing = agentsCache[index];
    const now = new Date().toISOString();

    let encrypted = existing.encryptedAuthSecret
      ? {
          encryptedData: existing.encryptedAuthSecret,
          iv: existing.authSecretIv!,
          tag: existing.authSecretTag!,
        }
      : undefined;

    if (input.authSecret !== undefined) {
      if (input.authSecret && input.authType !== 'NONE') {
        encrypted = encryptSecret(input.authSecret);
      } else {
        encrypted = undefined;
      }
    }

    const updated: StoredAgentRecord = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      version: input.version ?? existing.version,
      integrationType: input.integrationType ?? existing.integrationType,
      endpoint: input.endpoint ?? existing.endpoint,
      supportedLanguages: input.supportedLanguages ?? existing.supportedLanguages,
      supportedCapabilities: input.supportedCapabilities ?? existing.supportedCapabilities,
      authType: input.authType ?? existing.authType,
      authHeaderName: input.authHeaderName ?? existing.authHeaderName,
      encryptedAuthSecret: encrypted?.encryptedData,
      authSecretIv: encrypted?.iv,
      authSecretTag: encrypted?.tag,
      metadata: input.metadata ?? existing.metadata,
      updatedAt: now,
    };

    agentsCache[index] = updated;
    saveToDisk();

    return sanitizeAgent(updated);
  },

  delete(id: string): boolean {
    loadInitialData();
    const prevLen = agentsCache.length;
    agentsCache = agentsCache.filter(a => a.id !== id);
    if (agentsCache.length !== prevLen) {
      saveToDisk();
      return true;
    }
    return false;
  },

  updateStatus(id: string, result: ConnectionTestResult): Agent | null {
    loadInitialData();
    const index = agentsCache.findIndex(a => a.id === id);
    if (index === -1) return null;

    const existing = agentsCache[index];
    const now = result.testedAt || new Date().toISOString();

    let newStatus: ConnectionStatus = result.success ? 'CONNECTED' : 'UNREACHABLE';
    if (!result.success && result.errorMessage?.includes('SSRF')) {
      newStatus = 'ERROR';
    }

    const updated: StoredAgentRecord = {
      ...existing,
      connectionStatus: newStatus,
      lastCheckedAt: now,
      lastSuccessfulConnection: result.success ? now : existing.lastSuccessfulConnection,
      lastErrorMessage: result.success ? null : (result.errorMessage || 'Connection failed'),
      updatedAt: now,
    };

    agentsCache[index] = updated;
    saveToDisk();

    return sanitizeAgent(updated);
  },
};
