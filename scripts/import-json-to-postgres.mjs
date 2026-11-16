import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const names = ['agents', 'tasks', 'runs', 'evaluations'];
const readArray = (name) => {
  const filename = path.join(dataDir, `${name}.json`);
  if (!fs.existsSync(filename)) return [];
  const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${filename} must contain a JSON array`);
  return value;
};
const source = Object.fromEntries(names.map((name) => [name, readArray(name)]));
const executions = source.runs.flatMap((run) => Array.isArray(run.executions) ? run.executions : []);
const validEnums = {
  integrationType: ['HTTP', 'DOCKER', 'SDK'], authType: ['NONE', 'BEARER', 'API_KEY', 'CUSTOM_HEADER'],
  connectionStatus: ['CONNECTED', 'UNREACHABLE', 'ERROR', 'UNTESTED'], difficulty: ['EASY', 'MEDIUM', 'HARD'],
  runStatus: ['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED'],
  executionStatus: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMED_OUT'],
};
const reasonOnce = (list, reason) => { if (!list.includes(reason)) list.push(reason); };
const duplicateIds = (rows) => {
  const counts = new Map();
  for (const row of rows) if (row?.id) counts.set(row.id, (counts.get(row.id) || 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
};
const duplicateAgentIds = duplicateIds(source.agents);
const duplicateTaskIds = duplicateIds(source.tasks);
const duplicateRunIds = duplicateIds(source.runs);
const duplicateExecutionIds = duplicateIds(executions);
const duplicateEvaluationIds = duplicateIds(source.evaluations);
const agentById = new Map(source.agents.filter((x) => x?.id).map((x) => [x.id, x]));
const taskById = new Map(source.tasks.filter((x) => x?.id).map((x) => [x.id, x]));
const runById = new Map(source.runs.filter((x) => x?.id).map((x) => [x.id, x]));
const executionRecords = new Map();
const reportRows = { agents: [], tasks: [], runs: [], executions: [], evaluations: [] };

const validDate = (value) => value != null && Number.isFinite(new Date(value).getTime());
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const enumError = (record, key, choices) => record[key] != null && !choices.includes(record[key]) ? `invalid ${key}: ${record[key]}` : null;
const note = (list, reason) => reason && reasonOnce(list, reason);

for (const row of source.agents) {
  const reasons = [];
  if (!nonempty(row?.id) || !nonempty(row?.name) || !nonempty(row?.endpoint)) reasons.push('missing required id, name, or endpoint');
  if (!Array.isArray(row?.supportedLanguages) || !Array.isArray(row?.supportedCapabilities || [])) reasons.push('language/capability fields must be arrays');
  if (duplicateAgentIds.has(row?.id)) reasons.push('duplicate agent id');
  note(reasons, enumError(row, 'integrationType', validEnums.integrationType));
  note(reasons, enumError(row, 'authType', validEnums.authType));
  note(reasons, enumError(row, 'connectionStatus', validEnums.connectionStatus));
  if (!validDate(row?.createdAt) || !validDate(row?.updatedAt || row?.createdAt)) reasons.push('invalid createdAt/updatedAt timestamp');
  reportRows.agents.push({ id: row?.id ?? null, reasons });
}
for (const row of source.tasks) {
  const reasons = [];
  if (!nonempty(row?.id) || !nonempty(row?.title) || !nonempty(row?.description) || !nonempty(row?.language)) reasons.push('missing required id, title, description, or language');
  if (duplicateTaskIds.has(row?.id)) reasons.push('duplicate task id');
  note(reasons, enumError(row, 'difficulty', validEnums.difficulty));
  if (!Number.isInteger(row?.timeoutSeconds) || row.timeoutSeconds < 1 || !Number.isInteger(row?.maxOutputSizeBytes) || row.maxOutputSizeBytes < 1) reasons.push('invalid timeout or output-size limit');
  if (!validDate(row?.createdAt) || !validDate(row?.updatedAt || row?.createdAt)) reasons.push('invalid createdAt/updatedAt timestamp');
  reportRows.tasks.push({ id: row?.id ?? null, reasons });
}

const runReasons = new Map();
for (const row of source.runs) {
  const reasons = [];
  if (!nonempty(row?.id) || !nonempty(row?.title)) reasons.push('missing required run id or title');
  if (duplicateRunIds.has(row?.id)) reasons.push('duplicate run id');
  if (!taskById.has(row?.taskId) || reportRows.tasks.find((x) => x.id === row.taskId)?.reasons.length) reasons.push(`missing or invalid task parent: ${row?.taskId}`);
  note(reasons, enumError(row, 'status', validEnums.runStatus));
  if (!validDate(row?.startedAt || row?.createdAt)) reasons.push('invalid startedAt timestamp');
  if (!Array.isArray(row?.executions)) reasons.push('executions is not an array');
  runReasons.set(row?.id, reasons);
  reportRows.runs.push({ id: row?.id ?? null, reasons, executionIds: Array.isArray(row?.executions) ? row.executions.map((e) => e?.id ?? null) : [] });
}

for (const run of source.runs) {
  const reasons = runReasons.get(run?.id) || [];
  const seenAgents = new Set();
  for (const execution of Array.isArray(run?.executions) ? run.executions : []) {
    const itemReasons = [];
    if (!nonempty(execution?.id) || !nonempty(execution?.requestId)) itemReasons.push('missing execution id or requestId');
    if (duplicateExecutionIds.has(execution?.id)) itemReasons.push(`duplicate execution id: ${execution?.id}`);
    if (execution?.runId !== run?.id) itemReasons.push(`runId does not match containing run ${run?.id}`);
    if (!agentById.has(execution?.agentId) || reportRows.agents.find((x) => x.id === execution?.agentId)?.reasons.length) itemReasons.push(`missing or invalid agent parent: ${execution?.agentId}`);
    if (seenAgents.has(execution?.agentId)) itemReasons.push(`duplicate agent execution in run: ${execution?.agentId}`);
    seenAgents.add(execution?.agentId);
    note(itemReasons, enumError(execution, 'status', validEnums.executionStatus));
    if (!validDate(execution?.startedAt)) itemReasons.push('invalid startedAt timestamp');
    if (!executionRecords.has(execution?.id)) executionRecords.set(execution?.id, []);
    executionRecords.get(execution?.id).push({ run, execution, reasons: itemReasons });
    reportRows.executions.push({ id: execution?.id ?? null, runId: execution?.runId ?? null, agentId: execution?.agentId ?? null, reasons: itemReasons });
    for (const reason of itemReasons) note(reasons, reason);
  }
}

// A run containing any rejected execution is rejected as a unit; never import a partial benchmark history.
for (const row of reportRows.runs) {
  const childRows = reportRows.executions.filter((e) => e.runId === row.id);
  if (childRows.some((e) => e.reasons.length > 0)) note(row.reasons, 'contains one or more invalid executions');
  if (row.reasons.length > 0) {
    for (const child of childRows) note(child.reasons, `parent run skipped: ${row.reasons.join('; ')}`);
  }
}
const validRunIds = new Set(reportRows.runs.filter((r) => r.reasons.length === 0).map((r) => r.id));
const validExecutionIds = new Set(reportRows.executions.filter((e) => validRunIds.has(e.runId) && e.reasons.length === 0).map((e) => e.id));

for (const row of source.evaluations) {
  const reasons = [];
  const matches = executionRecords.get(row?.executionId) || [];
  const executionEntry = matches.length === 1 ? matches[0] : null;
  if (!nonempty(row?.id) || duplicateEvaluationIds.has(row?.id)) reasons.push(duplicateEvaluationIds.has(row?.id) ? 'duplicate evaluation id' : 'missing evaluation id');
  if (!executionEntry || !validExecutionIds.has(row?.executionId)) reasons.push(`missing, ambiguous, or skipped execution parent: ${row?.executionId}`);
  if (!validRunIds.has(row?.runId)) reasons.push(`missing or skipped run parent: ${row?.runId}`);
  if (!taskById.has(row?.taskId) || reportRows.tasks.find((x) => x.id === row?.taskId)?.reasons.length) reasons.push(`missing or invalid task parent: ${row?.taskId}`);
  if (!agentById.has(row?.agentId) || reportRows.agents.find((x) => x.id === row?.agentId)?.reasons.length) reasons.push(`missing or invalid agent parent: ${row?.agentId}`);
  if (executionEntry && (executionEntry.execution.runId !== row.runId || executionEntry.execution.agentId !== row.agentId || runById.get(row.runId)?.taskId !== row.taskId)) reasons.push('evaluation run/agent/task references disagree with its execution');
  for (const key of ['accuracyScore', 'completionScore', 'reliabilityScore', 'speedScore', 'overallScore']) {
    if (!Number.isFinite(row?.[key]) || row[key] < 0 || row[key] > 100) reasons.push(`invalid ${key}`);
  }
  if (row?.costEfficiencyScore != null && (!Number.isFinite(row.costEfficiencyScore) || row.costEfficiencyScore < 0 || row.costEfficiencyScore > 100)) reasons.push('invalid costEfficiencyScore');
  if (!validDate(row?.evaluatedAt || row?.createdAt)) reasons.push('invalid evaluation timestamp');
  reportRows.evaluations.push({ id: row?.id ?? null, runId: row?.runId ?? null, executionId: row?.executionId ?? null, reasons });
}

const eligible = {
  agents: source.agents.filter((_, i) => reportRows.agents[i].reasons.length === 0),
  tasks: source.tasks.filter((_, i) => reportRows.tasks[i].reasons.length === 0),
  runs: source.runs.filter((row) => validRunIds.has(row.id)),
  executions: executions.filter((row) => validExecutionIds.has(row.id)),
  evaluations: source.evaluations.filter((_, i) => reportRows.evaluations[i].reasons.length === 0),
};
const summaryFor = (rows) => ({ total: rows.length, valid: rows.filter((r) => r.reasons.length === 0).length, invalid: rows.filter((r) => r.reasons.length > 0).length });
const report = {
  mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
  inspected: {
    agents: source.agents.length, tasks: source.tasks.length, runs: source.runs.length,
    executions: executions.length, evaluations: source.evaluations.length,
    total: source.agents.length + source.tasks.length + source.runs.length + executions.length + source.evaluations.length,
  },
  records: Object.fromEntries(Object.entries(reportRows).map(([key, rows]) => [key, summaryFor(rows)])),
  reconciled: 0,
  reconciliationPolicy: 'Preserve source files; skip an invalid run and all its executions; never infer or rewrite a relationship.',
  skipped: Object.fromEntries(Object.entries(reportRows).map(([key, rows]) => [key, rows.filter((r) => r.reasons.length > 0)])),
};

if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for --apply');

const backupDir = path.join(dataDir, `pre-postgres-import-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(backupDir, { recursive: false });
for (const name of names) {
  const sourceFile = path.join(dataDir, `${name}.json`);
  if (fs.existsSync(sourceFile)) fs.copyFileSync(sourceFile, path.join(backupDir, `${name}.json`), fs.constants.COPYFILE_EXCL);
}
const date = (value) => value ? new Date(value) : null;
const prisma = new PrismaClient();
try {
  const inserted = await prisma.$transaction(async (tx) => {
    const result = {};
    result.agents = (await tx.agent.createMany({ data: eligible.agents.map((a) => ({
      id: a.id, name: a.name, description: a.description || null, version: a.version || '1.0.0',
      integrationType: a.integrationType || 'HTTP', endpoint: a.endpoint,
      supportedLanguages: a.supportedLanguages || [], supportedCapabilities: a.supportedCapabilities || [],
      authType: a.authType || 'NONE', authHeaderName: a.authHeaderName || null,
      encryptedAuthSecret: a.encryptedAuthSecret || null, authSecretIv: a.authSecretIv || null, authSecretTag: a.authSecretTag || null,
      connectionStatus: a.connectionStatus || 'UNTESTED', lastSuccessfulConnection: date(a.lastSuccessfulConnection),
      lastCheckedAt: date(a.lastCheckedAt), lastErrorMessage: a.lastErrorMessage || null, metadata: a.metadata || {},
      createdAt: date(a.createdAt), updatedAt: date(a.updatedAt || a.createdAt),
    })), skipDuplicates: true })).count;
    result.tasks = (await tx.benchmarkTask.createMany({ data: eligible.tasks.map((t) => ({
      ...t, ownerId: null, isShared: true, createdAt: date(t.createdAt), updatedAt: date(t.updatedAt || t.createdAt),
    })), skipDuplicates: true })).count;
    result.runs = (await tx.benchmarkRun.createMany({ data: eligible.runs.map((r) => ({
      id: r.id, title: r.title, taskId: r.taskId, status: r.status, startedAt: date(r.startedAt || r.createdAt),
      completedAt: date(r.completedAt), durationMs: r.durationMs ?? null,
    })), skipDuplicates: true })).count;
    result.executions = (await tx.agentExecution.createMany({ data: eligible.executions.map((e) => ({
      id: e.id, runId: e.runId, agentId: e.agentId, requestId: e.requestId || e.id, status: e.status,
      startedAt: date(e.startedAt), completedAt: date(e.completedAt), durationMs: e.durationMs ?? null,
      inputTokens: e.inputTokens ?? null, outputTokens: e.outputTokens ?? null, errorMessage: e.errorMessage || null,
      rawOutput: e.rawOutput ?? null, files: e.files ?? undefined, metadata: e.metadata || {},
    })), skipDuplicates: true })).count;
    result.evaluations = (await tx.executionEvaluation.createMany({ data: eligible.evaluations.map((e) => ({
      id: e.id, runId: e.runId, executionId: e.executionId, agentId: e.agentId, taskId: e.taskId,
      accuracyScore: e.accuracyScore, completionScore: e.completionScore, reliabilityScore: e.reliabilityScore,
      speedScore: e.speedScore, costEfficiencyScore: e.costEfficiencyScore ?? null, overallScore: e.overallScore,
      passedTestCount: e.passedTestCount || 0, failedTestCount: e.failedTestCount || 0, totalTestCount: e.totalTestCount || 0,
      evaluationStatus: e.evaluationStatus || 'EVALUATED', evaluationVersion: e.evaluationVersion || '1.0.0',
      breakdown: e.breakdown || {}, createdAt: date(e.evaluatedAt || e.createdAt),
    })), skipDuplicates: true })).count;
    return result;
  });
  report.inserted = inserted;
  report.alreadyPresent = Object.fromEntries(Object.keys(inserted).map((key) => [key, eligible[key].length - inserted[key]]));
  report.backupDirectory = backupDir;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await prisma.$disconnect();
}
