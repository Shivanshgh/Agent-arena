import fs from 'fs';
import path from 'path';
import { ExecutionEvaluation } from '../types/evaluation';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const EVALS_FILE = path.join(DATA_DIR, 'evaluations.json');

let evalsCache: ExecutionEvaluation[] = [];
let initialized = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveToDisk() {
  ensureDataDir();
  const tempFile = `${EVALS_FILE}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(evalsCache, null, 2), 'utf-8');
  fs.renameSync(tempFile, EVALS_FILE);
}

function loadInitialData() {
  if (initialized) return;
  ensureDataDir();

  if (fs.existsSync(EVALS_FILE)) {
    try {
      evalsCache = JSON.parse(fs.readFileSync(EVALS_FILE, 'utf-8'));
      initialized = true;
      return;
    } catch (e) {
      throw new Error(`evaluations.json exists but could not be parsed; refusing to overwrite existing data: ${String(e)}`);
    }
  }

  evalsCache = [];
  initialized = true;
}

export const evaluationDb = {
  listForRun(runId: string): ExecutionEvaluation[] {
    loadInitialData();
    return evalsCache.filter(e => e.runId === runId);
  },

  get(id: string): ExecutionEvaluation | null {
    loadInitialData();
    return evalsCache.find(e => e.id === id) || null;
  },

  saveEvaluations(evals: ExecutionEvaluation[]): void {
    loadInitialData();
    // Replace or add evaluations
    for (const ev of evals) {
      const idx = evalsCache.findIndex(
        e => e.runId === ev.runId && e.executionId === ev.executionId
      );
      if (idx !== -1) {
        evalsCache[idx] = ev;
      } else {
        evalsCache.unshift(ev);
      }
    }
    saveToDisk();
  },

  deleteForRun(runId: string): void {
    loadInitialData();
    evalsCache = evalsCache.filter(e => e.runId !== runId);
    saveToDisk();
  },
};
