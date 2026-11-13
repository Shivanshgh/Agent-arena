import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { BenchmarkTask, CreateTaskInput, UpdateTaskInput, BenchmarkRun, AgentExecution, RunStatus } from '../types/benchmark';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const RUNS_FILE = path.join(DATA_DIR, 'runs.json');

let tasksCache: BenchmarkTask[] = [];
let runsCache: BenchmarkRun[] = [];
let tasksInitialized = false;
let runsInitialized = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveTasksToDisk() {
  ensureDataDir();
  const tempFile = `${TASKS_FILE}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(tasksCache, null, 2), 'utf-8');
  fs.renameSync(tempFile, TASKS_FILE);
}

function saveRunsToDisk() {
  ensureDataDir();
  const tempFile = `${RUNS_FILE}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(runsCache, null, 2), 'utf-8');
  fs.renameSync(tempFile, RUNS_FILE);
}

function loadInitialTasks() {
  if (tasksInitialized) return;
  ensureDataDir();

  if (fs.existsSync(TASKS_FILE)) {
    try {
      tasksCache = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
      tasksInitialized = true;
      return;
    } catch (e) {
      throw new Error(`tasks.json exists but could not be parsed; refusing to overwrite existing data: ${String(e)}`);
    }
  }

  if (process.env.ENABLE_DEMO_SEED !== 'true' || process.env.NODE_ENV === 'production') {
    tasksCache = [];
    tasksInitialized = true;
    return;
  }

  const now = new Date().toISOString();
  tasksCache = [
    {
      id: 'task-reverse-words',
      title: 'Reverse Words in String',
      description: 'Given an input string s, reverse the order of the words while trimming excess spaces.',
      language: 'python',
      category: 'String Manipulation',
      difficulty: 'EASY',
      inputData: { s: '  the sky   is blue  ' },
      expectedOutput: 'blue is sky the',
      timeoutSeconds: 30,
      maxOutputSizeBytes: 100000,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'task-two-sum',
      title: 'Two Sum Problem',
      description: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.',
      language: 'typescript',
      category: 'Arrays & Hash Maps',
      difficulty: 'EASY',
      inputData: { nums: [2, 7, 11, 15], target: 9 },
      expectedOutput: '[0, 1]',
      timeoutSeconds: 30,
      maxOutputSizeBytes: 100000,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'task-merge-intervals',
      title: 'Merge Overlapping Intervals',
      description: 'Given an array of intervals where intervals[i] = [starti, endi], merge all overlapping intervals and return an array of non-overlapping intervals.',
      language: 'typescript',
      category: 'Intervals & Sorting',
      difficulty: 'MEDIUM',
      inputData: { intervals: [[1, 3], [2, 6], [8, 10], [15, 18]] },
      expectedOutput: '[[1, 6], [8, 10], [15, 18]]',
      timeoutSeconds: 45,
      maxOutputSizeBytes: 100000,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'task-lru-cache',
      title: 'Design LRU Cache Data Structure',
      description: 'Design a data structure that follows the constraints of a Least Recently Used (LRU) cache with O(1) get and put operations.',
      language: 'python',
      category: 'System Design & Data Structures',
      difficulty: 'HARD',
      inputData: { capacity: 2, operations: ['put', 'put', 'get', 'put', 'get'] },
      expectedOutput: 'null, null, 1, null, -1',
      timeoutSeconds: 60,
      maxOutputSizeBytes: 100000,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  saveTasksToDisk();
  tasksInitialized = true;
}

function loadInitialRuns() {
  if (runsInitialized) return;
  ensureDataDir();

  if (fs.existsSync(RUNS_FILE)) {
    try {
      runsCache = JSON.parse(fs.readFileSync(RUNS_FILE, 'utf-8'));
      runsInitialized = true;
      return;
    } catch (e) {
      throw new Error(`runs.json exists but could not be parsed; refusing to overwrite existing data: ${String(e)}`);
    }
  }

  runsCache = [];
  runsInitialized = true;
}

export const benchmarkDb = {
  // Tasks
  listTasks(filters: { language?: string; difficulty?: string; activeOnly?: boolean } = {}): BenchmarkTask[] {
    loadInitialTasks();
    return tasksCache.filter(t => {
      if (filters.activeOnly && !t.isActive) return false;
      if (filters.language && t.language.toLowerCase() !== filters.language.toLowerCase()) return false;
      if (filters.difficulty && t.difficulty !== filters.difficulty) return false;
      return true;
    });
  },

  getTask(id: string): BenchmarkTask | null {
    loadInitialTasks();
    return tasksCache.find(t => t.id === id) || null;
  },

  createTask(input: CreateTaskInput): BenchmarkTask {
    loadInitialTasks();
    const now = new Date().toISOString();
    const task: BenchmarkTask = {
      id: `task-${crypto.randomUUID()}`,
      title: input.title,
      description: input.description,
      language: input.language,
      category: input.category || 'Algorithms',
      difficulty: input.difficulty || 'MEDIUM',
      inputData: input.inputData || {},
      expectedOutput: input.expectedOutput,
      timeoutSeconds: input.timeoutSeconds || 60,
      maxOutputSizeBytes: input.maxOutputSizeBytes || 100000,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };

    tasksCache.unshift(task);
    saveTasksToDisk();
    return task;
  },

  updateTask(id: string, input: UpdateTaskInput): BenchmarkTask | null {
    loadInitialTasks();
    const index = tasksCache.findIndex(t => t.id === id);
    if (index === -1) return null;

    const existing = tasksCache[index];
    const updated: BenchmarkTask = {
      ...existing,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      language: input.language ?? existing.language,
      category: input.category ?? existing.category,
      difficulty: input.difficulty ?? existing.difficulty,
      inputData: input.inputData ?? existing.inputData,
      expectedOutput: input.expectedOutput !== undefined ? input.expectedOutput : existing.expectedOutput,
      timeoutSeconds: input.timeoutSeconds ?? existing.timeoutSeconds,
      maxOutputSizeBytes: input.maxOutputSizeBytes ?? existing.maxOutputSizeBytes,
      isActive: input.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString(),
    };

    tasksCache[index] = updated;
    saveTasksToDisk();
    return updated;
  },

  deleteTask(id: string): boolean {
    loadInitialTasks();
    const prevLen = tasksCache.length;
    tasksCache = tasksCache.filter(t => t.id !== id);
    if (tasksCache.length !== prevLen) {
      saveTasksToDisk();
      return true;
    }
    return false;
  },

  // Runs
  listRuns(): BenchmarkRun[] {
    loadInitialRuns();
    return runsCache;
  },

  getRun(id: string): BenchmarkRun | null {
    loadInitialRuns();
    return runsCache.find(r => r.id === id) || null;
  },

  createRun(run: BenchmarkRun): BenchmarkRun {
    loadInitialRuns();
    runsCache.unshift(run);
    saveRunsToDisk();
    return run;
  },

  updateRun(id: string, updates: Partial<BenchmarkRun>): BenchmarkRun | null {
    loadInitialRuns();
    const index = runsCache.findIndex(r => r.id === id);
    if (index === -1) return null;

    runsCache[index] = { ...runsCache[index], ...updates };
    saveRunsToDisk();
    return runsCache[index];
  },

  updateExecution(runId: string, executionId: string, updates: Partial<AgentExecution>): BenchmarkRun | null {
    loadInitialRuns();
    const run = runsCache.find(r => r.id === runId);
    if (!run) return null;

    const execIndex = run.executions.findIndex(e => e.id === executionId);
    if (execIndex === -1) return null;

    run.executions[execIndex] = { ...run.executions[execIndex], ...updates };

    // Compute overall run status
    const allDone = run.executions.every(e => ['COMPLETED', 'FAILED', 'TIMED_OUT'].includes(e.status));
    if (allDone) {
      const completedCount = run.executions.filter(e => e.status === 'COMPLETED').length;
      if (completedCount === run.executions.length) {
        run.status = 'COMPLETED';
      } else if (completedCount > 0) {
        run.status = 'PARTIALLY_FAILED';
      } else {
        run.status = 'FAILED';
      }
      run.completedAt = new Date().toISOString();
      if (run.startedAt) {
        run.durationMs = Math.round(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime());
      }
    } else {
      run.status = 'RUNNING';
    }

    saveRunsToDisk();
    return run;
  },
};
