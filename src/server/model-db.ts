import { ModelProvider } from '@prisma/client';
import { prisma } from './prisma';
import { decryptSecret, encryptSecret } from './crypto';
import type { AuthUser } from './auth';
import type { ModelProviderId } from './model-providers';
import type { ModelBenchmarkExecution, BenchmarkTask } from '../types/benchmark';

export interface ModelConnectionView {
  id: string; provider: ModelProviderId; modelId: string; displayName: string; createdAt: string;
}

export const modelDb = {
  async list(owner: AuthUser): Promise<ModelConnectionView[]> {
    const rows = await prisma.modelConnection.findMany({ where: { ownerId: owner.id }, orderBy: [{ provider: 'asc' }, { modelId: 'asc' }] });
    return rows.map(row => ({ id: row.id, provider: row.provider, modelId: row.modelId, displayName: row.displayName, createdAt: row.createdAt.toISOString() }));
  },
  async upsert(owner: AuthUser, provider: ModelProviderId, apiKey: string, modelId: string, displayName: string): Promise<ModelConnectionView> {
    const encrypted = encryptSecret(apiKey);
    const result = await prisma.$transaction(async tx => {
      const credential = await tx.providerCredential.upsert({
        where: { ownerId_provider: { ownerId: owner.id, provider: provider as ModelProvider } },
        create: { ownerId: owner.id, provider: provider as ModelProvider, encryptedApiKey: encrypted.encryptedData, apiKeyIv: encrypted.iv, apiKeyTag: encrypted.tag },
        update: { encryptedApiKey: encrypted.encryptedData, apiKeyIv: encrypted.iv, apiKeyTag: encrypted.tag },
      });
      return tx.modelConnection.upsert({
        where: { ownerId_provider_modelId: { ownerId: owner.id, provider: provider as ModelProvider, modelId } },
        create: { ownerId: owner.id, credentialId: credential.id, provider: provider as ModelProvider, modelId, displayName },
        update: { credentialId: credential.id, displayName },
      });
    });
    return { id: result.id, provider: result.provider, modelId: result.modelId, displayName: result.displayName, createdAt: result.createdAt.toISOString() };
  },
  async getWithKey(id: string, owner: AuthUser) {
    const row = await prisma.modelConnection.findFirst({ where: { id, ownerId: owner.id }, include: { credential: true } });
    if (!row) return null;
    return {
      connection: { id: row.id, provider: row.provider as ModelProviderId, modelId: row.modelId, displayName: row.displayName },
      apiKey: decryptSecret({ encryptedData: row.credential.encryptedApiKey, iv: row.credential.apiKeyIv, tag: row.credential.apiKeyTag }),
    };
  },
  async getForWorker(id: string) {
    const row = await prisma.modelConnection.findUnique({ where: { id }, include: { credential: true } });
    if (!row) return null;
    return {
      connection: { id: row.id, provider: row.provider as ModelProviderId, modelId: row.modelId, displayName: row.displayName },
      apiKey: decryptSecret({ encryptedData: row.credential.encryptedApiKey, iv: row.credential.apiKeyIv, tag: row.credential.apiKeyTag }),
    };
  },
  async evaluateRun(runId: string, task: BenchmarkTask, executions: ModelBenchmarkExecution[]) {
    await prisma.$transaction(executions.map(execution => {
      const completed = execution.status === 'COMPLETED';
      const completionScore = completed ? 100 : 0;
      const reliabilityScore = completed ? 100 : 0;
      const duration = execution.durationMs || 0;
      const speedScore = !completed ? 0 : duration <= 100 ? 100 : duration <= 500 ? 95 : duration <= 2000 ? 90 : Math.max(10, Math.round(100 * (1 - Math.min(1, duration / (task.timeoutSeconds * 1000)))));
      let accuracyScore: number | null = null;
      let overallScore: number | null = null;
      let evaluationStatus = 'UNVERIFIED';
      const evidence: Record<string, unknown> = { correctness: 'Unavailable; submitted code is not executed by this evaluator.' };
      if (task.expectedOutput && task.evaluationStrategy === 'EXACT_MATCH') {
        accuracyScore = completed && execution.rawOutput?.trim() === task.expectedOutput.trim() ? 100 : 0;
        overallScore = Math.round((accuracyScore * 0.4 + completionScore * 0.25 + reliabilityScore * 0.15 + speedScore * 0.1) / 0.9);
        evaluationStatus = 'VERIFIED_EXACT_MATCH';
        evidence.correctness = 'Exact response comparison against task expected output.';
      } else if (task.expectedOutput && task.evaluationStrategy === 'JSON_EXACT') {
        try {
          const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
            : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
          const actual = canonical(JSON.parse(execution.rawOutput || ''));
          const expected = canonical(JSON.parse(task.expectedOutput));
          accuracyScore = completed && actual === expected ? 100 : 0;
          overallScore = Math.round((accuracyScore * 0.4 + completionScore * 0.25 + reliabilityScore * 0.15 + speedScore * 0.1) / 0.9);
          evaluationStatus = 'VERIFIED_JSON_EXACT';
          evidence.correctness = 'Parsed JSON value compared with task expected output.';
        } catch { accuracyScore = 0; overallScore = Math.round((completionScore * 0.25 + reliabilityScore * 0.15 + speedScore * 0.1) / 0.9); evaluationStatus = 'VERIFIED_JSON_INVALID'; evidence.correctness = 'Response or expected output was not valid JSON.'; }
      }
      return prisma.modelEvaluation.upsert({
        where: { modelExecutionId: execution.id },
        create: { runId, modelExecutionId: execution.id, accuracyScore, completionScore,
          reliabilityScore, speedScore,
          costEfficiencyScore: null, overallScore, evaluationStatus, breakdown: evidence as any },
        update: { accuracyScore, completionScore, reliabilityScore, speedScore,
          overallScore, evaluationStatus, breakdown: evidence as any, createdAt: new Date() },
      });
    }));
  },
  async attachSemanticReviews(reviews: Array<{ executionId: string; review: unknown }>) {
    const rows = await Promise.all(reviews.map(({ executionId }) => prisma.modelEvaluation.findUnique({ where: { modelExecutionId: executionId }, select: { breakdown: true } })));
    const updates = reviews.map(({ executionId, review }, index) => {
      const row = rows[index];
      const prior = row?.breakdown && typeof row.breakdown === 'object' && !Array.isArray(row.breakdown) ? row.breakdown as Record<string, unknown> : {};
      return prisma.modelEvaluation.update({ where: { modelExecutionId: executionId }, data: { breakdown: { ...prior, semanticReview: review } as any } });
    });
    await prisma.$transaction(updates);
  },
  async leaderboard(owner: AuthUser, filters: { category?: string; runId?: string } = {}) {
    const rows = await prisma.modelEvaluation.findMany({
      where: { run: { ownerId: owner.id, ...(filters.runId ? { id: filters.runId } : {}), ...(filters.category ? { task: { category: filters.category } } : {}) }, overallScore: { not: null } },
      include: { modelExecution: true, run: { include: { task: true } } }, orderBy: [{ overallScore: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row, index) => ({ rank: index + 1, provider: row.modelExecution.provider, modelId: row.modelExecution.modelId,
      category: row.run.task.category, runId: row.runId, accuracyScore: row.accuracyScore, completionScore: row.completionScore,
      reliabilityScore: row.reliabilityScore, speedScore: row.speedScore, costEfficiencyScore: row.costEfficiencyScore,
      overallScore: row.overallScore, evaluationStatus: row.evaluationStatus, evaluatedAt: row.createdAt.toISOString() }));
  },
  async deleteConnection(id: string, owner: AuthUser): Promise<boolean> {
    return prisma.$transaction(async tx => {
      const row = await tx.modelConnection.findFirst({ where: { id, ownerId: owner.id }, select: { credentialId: true } });
      if (!row) return false;
      await tx.modelConnection.delete({ where: { id } });
      const remaining = await tx.modelConnection.count({ where: { credentialId: row.credentialId } });
      if (!remaining) await tx.providerCredential.delete({ where: { id: row.credentialId } });
      return true;
    });
  },
  async deleteProviderKey(provider: ModelProviderId, owner: AuthUser): Promise<boolean> {
    const row = await prisma.providerCredential.findFirst({ where: { ownerId: owner.id, provider: provider as ModelProvider }, select: { id: true } });
    if (!row) return false;
    await prisma.providerCredential.delete({ where: { id: row.id } });
    return true;
  },
};
