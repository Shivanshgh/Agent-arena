import assert from 'node:assert/strict';
import { BenchmarkOrchestrator } from '../server/orchestrator';
import { runtimeDb } from '../server/runtime-db';
import { modelDb } from '../server/model-db';
import { modelAdapters, ModelProviderError } from '../server/model-providers';

async function main() {
  const saved = {
    getTask: runtimeDb.getTask, createRun: runtimeDb.createRun, getRun: runtimeDb.getRun,
    updateModelExecution: runtimeDb.updateModelExecution, refreshRunStatus: runtimeDb.refreshRunStatus,
    getWithKey: modelDb.getWithKey, getForWorker: modelDb.getForWorker, adapter: modelAdapters.OPENAI,
  };
  const task = { id: 'task-fixture', title: 'Answer', description: 'Return one value.', language: 'text', category: 'tests', difficulty: 'EASY', inputData: { q: 6 }, expectedOutput: '42', evaluationStrategy: 'EXACT_MATCH', timeoutSeconds: 5, maxOutputSizeBytes: 10000, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any;
  let stored: any;
  const contexts = new Map(['model-a', 'model-b', 'model-fail'].map(id => [id, { connection: { id, provider: 'OPENAI', modelId: id, displayName: id }, apiKey: 'encrypted-fixture-secret' }]));
  const prompts: string[] = [];
  try {
    (runtimeDb as any).getTask = async () => task;
    (runtimeDb as any).createRun = async (run: any) => { stored = structuredClone(run); return stored; };
    (runtimeDb as any).getRun = async (id: string) => id === stored?.id ? stored : null;
    (runtimeDb as any).refreshRunStatus = async () => stored;
    (runtimeDb as any).updateModelExecution = async (_runId: string, id: string, changes: any) => {
      const execution = stored.modelExecutions.find((item: any) => item.id === id);
      Object.assign(execution, changes);
      const rows = stored.modelExecutions;
      if (rows.every((item: any) => ['COMPLETED', 'FAILED', 'TIMED_OUT'].includes(item.status))) {
        const passed = rows.filter((item: any) => item.status === 'COMPLETED').length;
        stored.status = passed === rows.length ? 'COMPLETED' : passed ? 'PARTIALLY_FAILED' : 'FAILED';
      } else stored.status = rows.some((item: any) => item.status === 'RUNNING') ? 'RUNNING' : 'QUEUED';
      return stored;
    };
    (modelDb as any).getWithKey = async (id: string) => contexts.get(id) || null;
    (modelDb as any).getForWorker = async (id: string) => contexts.get(id) || null;
    (modelAdapters as any).OPENAI = { listModels: async () => [], execute: async (_key: string, modelId: string, prompt: string) => {
      prompts.push(prompt);
      if (modelId === 'model-fail') throw new ModelProviderError('Provider rejected the model.', 404);
      return { provider: 'OPENAI', modelId, content: modelId === 'model-a' ? '42' : '41', usage: { inputTokens: 10, outputTokens: 2 }, durationMs: 4 };
    } };

    const complete = await BenchmarkOrchestrator.createAndLaunchRun({ taskId: task.id, modelConnectionIds: ['model-a', 'model-b'] }, { waitForCompletion: true, actor: { id: 'owner-a' } as any });
    assert.equal(complete.status, 'COMPLETED');
    assert.deepEqual(complete.modelExecutions?.map(item => item.status), ['COMPLETED', 'COMPLETED']);
    assert.equal(complete.modelExecutions?.[0].inputTokens, 10);
    assert.equal(prompts[0], prompts[1], 'selected models must get identical prompt content');

    const partial = await BenchmarkOrchestrator.createAndLaunchRun({ taskId: task.id, modelConnectionIds: ['model-a', 'model-fail'] }, { waitForCompletion: true, actor: { id: 'owner-a' } as any });
    assert.equal(partial.status, 'PARTIALLY_FAILED');
    assert.equal(partial.modelExecutions?.filter(item => item.status === 'COMPLETED').length, 1);
    assert.equal(partial.modelExecutions?.filter(item => item.status === 'FAILED').length, 1);
    console.log('PASS shared run orchestration: identical prompts, persisted result shape, metrics, and isolated provider failure');
  } finally {
    Object.assign(runtimeDb, { getTask: saved.getTask, createRun: saved.createRun, getRun: saved.getRun, updateModelExecution: saved.updateModelExecution, refreshRunStatus: saved.refreshRunStatus });
    Object.assign(modelDb, { getWithKey: saved.getWithKey, getForWorker: saved.getForWorker });
    (modelAdapters as any).OPENAI = saved.adapter;
  }
}
main().catch(error => { console.error('Model orchestration tests failed:', error.message); process.exitCode = 1; });
