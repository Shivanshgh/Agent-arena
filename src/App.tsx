import React, { useState, useEffect, useMemo } from 'react';
import {
  Server,
  ShieldCheck,
  ShieldAlert,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plus,
  RefreshCw,
  Play,
  Code2,
  Terminal,
  BookOpen,
  Trash2,
  Edit3,
  Copy,
  Lock,
  Cpu,
  Layers,
  Search,
  Filter,
  Check,
  Zap,
  Clock,
  ArrowRight,
  Database,
  Swords,
  ListTodo,
  Eye,
  FileCode2,
  BarChart3,
  Flame,
  ChevronRight,
  Trophy,
  Download,
  Box,
  Network,
  Sliders,
  PieChart
} from 'lucide-react';
import { Agent, ConnectionTestResult, StandardizedAgentRequest, StandardizedAgentResponse } from './types/agent';
import { BenchmarkTask, BenchmarkRun, TaskDifficulty, RunStatus, ExecutionStatus } from './types/benchmark';
import { ExecutionEvaluation } from './types/evaluation';
import { LeaderboardEntry, AnalyticsOverview, InfrastructureStatus } from './types/analytics';

const COMMON_LANGUAGES = ['typescript', 'javascript', 'python', 'go', 'rust', 'c++', 'java', 'sql'];
const COMMON_CAPABILITIES = [
  { id: 'code_generation', label: 'Code Generation' },
  { id: 'code_refactoring', label: 'Code Refactoring' },
  { id: 'test_generation', label: 'Test Generation' },
  { id: 'debugging', label: 'Debugging' },
  { id: 'multi_file_editing', label: 'Multi-file Editing' },
];

export default function App({ user, onLogout }: { user: { email: string; role: 'USER' | 'ADMIN' }; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<'registry' | 'tasks' | 'runs' | 'leaderboard' | 'analytics' | 'infrastructure' | 'docs'>('leaderboard');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<BenchmarkTask[]>([]);
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [loading, setLoading] = useState(true);

  // Stage 5 Evaluation States
  const [evaluations, setEvaluations] = useState<ExecutionEvaluation[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [selectedEvalDetail, setSelectedEvalDetail] = useState<ExecutionEvaluation | null>(null);

  // Stage 6 Leaderboard & Analytics States
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [leaderboardLang, setLeaderboardLang] = useState<string>('ALL');
  const [leaderboardCat, setLeaderboardCat] = useState<string>('ALL');

  // Stage 7 Infrastructure State
  const [infraStatus, setInfraStatus] = useState<InfrastructureStatus | null>(null);
  const [loadingInfra, setLoadingInfra] = useState(false);

  // Search & Filters
  const [agentSearch, setAgentSearch] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [taskDifficultyFilter, setTaskDifficultyFilter] = useState<string>('ALL');
  const [taskLanguageFilter, setTaskLanguageFilter] = useState<string>('ALL');

  // Modals & Drawers
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [testingAgent, setTestingAgent] = useState<Agent | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [isTestingInProgress, setIsTestingInProgress] = useState(false);

  // Task Modal state
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<BenchmarkTask | null>(null);
  const [taskFormTitle, setTaskFormTitle] = useState('');
  const [taskFormDesc, setTaskFormDesc] = useState('');
  const [taskFormLang, setTaskFormLang] = useState('python');
  const [taskFormCategory, setTaskFormCategory] = useState('Algorithms');
  const [taskFormDifficulty, setTaskFormDifficulty] = useState<TaskDifficulty>('MEDIUM');
  const [taskFormInputJson, setTaskFormInputJson] = useState('{}');
  const [taskFormExpected, setTaskFormExpected] = useState('');
  const [taskFormTimeout, setTaskFormTimeout] = useState(60);
  const [taskFormError, setTaskFormError] = useState<string | null>(null);
  const [isSavingTask, setIsSavingTask] = useState(false);

  // New Benchmark Run Wizard Modal
  const [isNewRunModalOpen, setIsNewRunModalOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [runTitleInput, setRunTitleInput] = useState('');
  const [isLaunchingRun, setIsLaunchingRun] = useState(false);
  const [runLaunchError, setRunLaunchError] = useState<string | null>(null);

  // Active / Selected Run View
  const [viewingRun, setViewingRun] = useState<BenchmarkRun | null>(null);

  // Protocol Tester State
  const [testerAgent, setTesterAgent] = useState<Agent | null>(null);
  const [testerOutput, setTesterOutput] = useState<any>(null);
  const [testerLoading, setTesterLoading] = useState(false);

  // Registration Form State (Agent)
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formVersion, setFormVersion] = useState('1.0.0');
  const [formEndpoint, setFormEndpoint] = useState('');
  const [formAuthType, setFormAuthType] = useState<'NONE' | 'BEARER' | 'API_KEY' | 'CUSTOM_HEADER'>('NONE');
  const [formHeaderName, setFormHeaderName] = useState('');
  const [formSecret, setFormSecret] = useState('');
  const [formLanguages, setFormLanguages] = useState<string[]>(['typescript', 'python']);
  const [formCapabilities, setFormCapabilities] = useState<string[]>(['code_generation']);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [directTestFeedback, setDirectTestFeedback] = useState<{ success: boolean; msg: string; latency?: number } | null>(null);

  // Data Loading
  const fetchData = async () => {
    try {
      setLoading(true);
      const [resAgents, resTasks, resRuns] = await Promise.all([
        fetch('/api/agents').then(r => r.json()),
        fetch('/api/tasks').then(r => r.json()),
        fetch('/api/runs').then(r => r.json()),
      ]);

      if (resAgents.success) setAgents(resAgents.data);
      if (resTasks.success) setTasks(resTasks.data);
      if (resRuns.success) setRuns(resRuns.data);
    } catch (err) {
      console.error('Failed fetching data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Polling for active runs
  useEffect(() => {
    const hasActiveRun = runs.some(r => r.status === 'RUNNING' || r.status === 'QUEUED') ||
      (viewingRun && (viewingRun.status === 'RUNNING' || viewingRun.status === 'QUEUED'));

    if (!hasActiveRun) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/runs');
        const data = await res.json();
        if (data.success) {
          setRuns(data.data);
          if (viewingRun) {
            const updated = data.data.find((r: BenchmarkRun) => r.id === viewingRun.id);
            if (updated) setViewingRun(updated);
          }
        }
      } catch (e) {
        console.error('Polling error', e);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [runs, viewingRun]);

  // Load evaluations when viewing a run
  useEffect(() => {
    if (viewingRun) {
      fetchEvaluationsForRun(viewingRun.id);
    } else {
      setEvaluations([]);
    }
  }, [viewingRun?.id]);

  const fetchEvaluationsForRun = async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}/evaluations`);
      const data = await res.json();
      if (data.success) {
        setEvaluations(data.data);
      }
    } catch (err) {
      console.error('Failed fetching evaluations', err);
    }
  };

  const handleEvaluateRun = async (recalculate = false) => {
    if (!viewingRun) return;
    setIsEvaluating(true);
    try {
      const res = await fetch(`/api/runs/${viewingRun.id}/evaluate?recalculate=${recalculate}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setEvaluations(data.data);
      }
    } catch (err) {
      console.error('Failed evaluating run', err);
    } finally {
      setIsEvaluating(false);
    }
  };

  const fetchLeaderboard = async (lang = leaderboardLang, cat = leaderboardCat) => {
    try {
      const params = new URLSearchParams();
      if (lang && lang !== 'ALL') params.set('language', lang);
      if (cat && cat !== 'ALL') params.set('category', cat);
      const res = await fetch(`/api/leaderboard?${params.toString()}`);
      const data = await res.json();
      if (data.success) setLeaderboard(data.data);
    } catch (err) {
      console.error('Failed fetching leaderboard', err);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const res = await fetch('/api/analytics');
      const data = await res.json();
      if (data.success) setAnalytics(data.data);
    } catch (err) {
      console.error('Failed fetching analytics', err);
    }
  };

  const fetchInfrastructure = async () => {
    setLoadingInfra(true);
    try {
      const res = await fetch('/api/infrastructure/status');
      const data = await res.json();
      if (data.success) setInfraStatus(data.data);
    } catch (err) {
      console.error('Failed fetching infrastructure status', err);
    } finally {
      setLoadingInfra(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'leaderboard') fetchLeaderboard(leaderboardLang, leaderboardCat);
    if (activeTab === 'analytics') fetchAnalytics();
    if (activeTab === 'infrastructure') fetchInfrastructure();
  }, [activeTab, leaderboardLang, leaderboardCat]);

  const handleExportReport = (runId: string, format: 'json' | 'csv') => {
    const a = document.createElement('a');
    a.href = `/api/runs/${runId}/export?format=${format}`;
    a.download = `benchmark-${runId}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Open Task Modal
  const openTaskModal = (task?: BenchmarkTask) => {
    if (task) {
      setEditingTask(task);
      setTaskFormTitle(task.title);
      setTaskFormDesc(task.description);
      setTaskFormLang(task.language);
      setTaskFormCategory(task.category);
      setTaskFormDifficulty(task.difficulty);
      setTaskFormInputJson(JSON.stringify(task.inputData || {}, null, 2));
      setTaskFormExpected(task.expectedOutput || '');
      setTaskFormTimeout(task.timeoutSeconds);
    } else {
      setEditingTask(null);
      setTaskFormTitle('');
      setTaskFormDesc('');
      setTaskFormLang('python');
      setTaskFormCategory('Algorithms');
      setTaskFormDifficulty('MEDIUM');
      setTaskFormInputJson('{\n  "input": "sample"\n}');
      setTaskFormExpected('');
      setTaskFormTimeout(60);
    }
    setTaskFormError(null);
    setIsTaskModalOpen(true);
  };

  // Save Task
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setTaskFormError(null);

    let parsedInput = {};
    try {
      parsedInput = taskFormInputJson.trim() ? JSON.parse(taskFormInputJson) : {};
    } catch {
      setTaskFormError('Input Data must be valid JSON');
      return;
    }

    setIsSavingTask(true);
    try {
      const payload = {
        title: taskFormTitle.trim(),
        description: taskFormDesc.trim(),
        language: taskFormLang.trim(),
        category: taskFormCategory.trim(),
        difficulty: taskFormDifficulty,
        inputData: parsedInput,
        expectedOutput: taskFormExpected.trim() || undefined,
        timeoutSeconds: Number(taskFormTimeout),
      };

      const url = editingTask ? `/api/tasks/${editingTask.id}` : '/api/tasks';
      const method = editingTask ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setTaskFormError(data.error || 'Failed to save task');
        setIsSavingTask(false);
        return;
      }

      setIsTaskModalOpen(false);
      const resTasks = await fetch('/api/tasks').then(r => r.json());
      if (resTasks.success) setTasks(resTasksTasks => resTasks.data);
    } catch (err: any) {
      setTaskFormError(err.message);
    } finally {
      setIsSavingTask(false);
    }
  };

  // Delete Task
  const handleDeleteTask = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete benchmark task "${title}"?`)) return;
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTasks(prev => prev.filter(t => t.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete task', err);
    }
  };

  // Open New Run Wizard
  const openNewRunWizard = (preselectedTaskId?: string) => {
    setSelectedTaskId(preselectedTaskId || (tasks[0]?.id ?? ''));
    setSelectedAgentIds([]);
    setRunTitleInput('');
    setRunLaunchError(null);
    setIsNewRunModalOpen(true);
  };

  // Launch Run
  const handleLaunchRun = async () => {
    setRunLaunchError(null);
    if (!selectedTaskId) {
      setRunLaunchError('Please select a benchmark task.');
      return;
    }
    if (selectedAgentIds.length < 2) {
      setRunLaunchError('You must select at least 2 distinct agents for a benchmark battle.');
      return;
    }

    setIsLaunchingRun(true);
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: runTitleInput.trim() || undefined,
          taskId: selectedTaskId,
          agentIds: selectedAgentIds,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setRunLaunchError(data.error || 'Failed to launch benchmark run');
        setIsLaunchingRun(false);
        return;
      }

      setIsNewRunModalOpen(false);
      setViewingRun(data.data);
      setActiveTab('runs');

      // Refresh runs list
      const runsRes = await fetch('/api/runs').then(r => r.json());
      if (runsRes.success) setRuns(runsRes.data);
    } catch (err: any) {
      setRunLaunchError(err.message);
    } finally {
      setIsLaunchingRun(false);
    }
  };

  // Agent Connection Test
  const handleTestAgent = async (agent: Agent) => {
    setTestingAgent(agent);
    setTestResult(null);
    setIsTestingInProgress(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/test-connection`, { method: 'POST' });
      const data = await res.json();
      setTestResult(data.testResult);
      if (data.agent) {
        setAgents(prev => prev.map(a => (a.id === agent.id ? data.agent : a)));
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        latencyMs: 0,
        errorMessage: err.message,
        testedAt: new Date().toISOString(),
      });
    } finally {
      setIsTestingInProgress(false);
    }
  };

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const matchesSearch =
        task.title.toLowerCase().includes(taskSearch.toLowerCase()) ||
        task.description.toLowerCase().includes(taskSearch.toLowerCase());
      const matchesDiff = taskDifficultyFilter === 'ALL' || task.difficulty === taskDifficultyFilter;
      const matchesLang = taskLanguageFilter === 'ALL' || task.language.toLowerCase() === taskLanguageFilter.toLowerCase();
      return matchesSearch && matchesDiff && matchesLang;
    });
  }, [tasks, taskSearch, taskDifficultyFilter, taskLanguageFilter]);

  // Selected Task Object for Run Wizard
  const wizardTask = useMemo(() => tasks.find(t => t.id === selectedTaskId), [tasks, selectedTaskId]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-cyan-500/20 selection:text-cyan-300">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-indigo-600 to-amber-500 flex items-center justify-center shadow-lg shadow-cyan-500/10 border border-neutral-700">
              <Swords className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold tracking-tight text-lg text-white">AgentArena</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
                  Stage 8 Ready (Stages 1–8 Complete)
                </span>
              </div>
              <p className="text-xs text-neutral-400">AI Coding Agent Benchmark, Deterministic Evaluation Engine & Multi-Provider Arena</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex items-center space-x-1 bg-neutral-900 border border-neutral-800 rounded-lg p-1 overflow-x-auto">
            <button
              onClick={() => { setActiveTab('leaderboard'); setViewingRun(null); }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                activeTab === 'leaderboard' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>Leaderboard</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-neutral-800 text-neutral-400">{leaderboard.length}</span>
            </button>

            <button
              onClick={() => { setActiveTab('analytics'); setViewingRun(null); }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                activeTab === 'analytics' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Analytics</span>
            </button>

            <button
              onClick={() => { setActiveTab('tasks'); setViewingRun(null); }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                activeTab === 'tasks' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <ListTodo className="w-3.5 h-3.5 text-cyan-400" />
              <span>Tasks</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-neutral-800 text-neutral-400">{tasks.length}</span>
            </button>

            <button
              onClick={() => setActiveTab('runs')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                activeTab === 'runs' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Swords className="w-3.5 h-3.5 text-amber-400" />
              <span>Battles & Runs</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-neutral-800 text-neutral-400">{runs.length}</span>
            </button>

            <button
              onClick={() => { setActiveTab('registry'); setViewingRun(null); }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                activeTab === 'registry' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Database className="w-3.5 h-3.5 text-indigo-400" />
              <span>Agents</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-neutral-800 text-neutral-400">{agents.length}</span>
            </button>

            <button
              onClick={() => { setActiveTab('infrastructure'); setViewingRun(null); }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                activeTab === 'infrastructure' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>Infrastructure</span>
              <span className={`w-2 h-2 rounded-full ${infraStatus?.docker.isolationReady && infraStatus?.redis.status === 'CONNECTED' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            </button>

            <button
              onClick={() => { setActiveTab('docs'); setViewingRun(null); }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                activeTab === 'docs' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-neutral-400" />
              <span>Protocol v1.0</span>
            </button>
          </nav>

          {/* Quick Actions */}
          <div className="flex items-center space-x-2">
            <span className="hidden xl:inline text-xs text-neutral-400">{user.email}</span>
            <button onClick={onLogout} className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:text-white">Sign out</button>
            <button
              onClick={() => openNewRunWizard()}
              className="inline-flex items-center space-x-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-neutral-950 font-semibold text-xs px-3.5 py-2 rounded-lg shadow-sm shadow-amber-500/20 transition active:scale-95 cursor-pointer"
            >
              <Flame className="w-3.5 h-3.5 fill-current" />
              <span>Launch Battle</span>
            </button>

            <button
              onClick={() => openTaskModal()}
              className="inline-flex items-center space-x-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium px-3 py-2 rounded-lg transition"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              <span>New Task</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Metric Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-neutral-900/70 border border-neutral-800 rounded-xl p-4">
            <div className="flex items-center justify-between text-neutral-400 mb-1">
              <span className="text-xs font-medium">Benchmark Tasks</span>
              <ListTodo className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-white">{tasks.length}</div>
            <div className="text-[11px] text-neutral-500">Algorithms & Coding Challenges</div>
          </div>

          <div className="bg-neutral-900/70 border border-neutral-800 rounded-xl p-4">
            <div className="flex items-center justify-between text-neutral-400 mb-1">
              <span className="text-xs font-medium">Registered Agents</span>
              <Database className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-indigo-400">{agents.length}</div>
            <div className="text-[11px] text-neutral-500">{agents.filter(a => a.connectionStatus === 'CONNECTED').length} Online & Verified</div>
          </div>

          <div className="bg-neutral-900/70 border border-neutral-800 rounded-xl p-4">
            <div className="flex items-center justify-between text-neutral-400 mb-1">
              <span className="text-xs font-medium">Total Battles Orchestrated</span>
              <Swords className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-amber-400">{runs.length}</div>
            <div className="text-[11px] text-neutral-500">Multi-Agent Evaluations</div>
          </div>

          <div className="bg-neutral-900/70 border border-neutral-800 rounded-xl p-4">
            <div className="flex items-center justify-between text-neutral-400 mb-1">
              <span className="text-xs font-medium">Orchestration Safety</span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold tracking-tight text-emerald-400">Guarded</div>
            <div className="text-[11px] text-neutral-500">Timeout & Partial Failure Isolation</div>
          </div>
        </div>

        {/* TAB: LEADERBOARD (Stage 6) */}
        {activeTab === 'leaderboard' && (
          <div className="space-y-6">
            {/* Header & Filter Controls */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-neutral-900/60 p-4 rounded-xl border border-neutral-800">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <Trophy className="w-5 h-5 text-amber-400" />
                  <h2 className="text-base font-bold text-white tracking-tight">AI Coding Agent Global Leaderboard</h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-800/80">
                    Deterministic Scoring
                  </span>
                </div>
                <p className="text-xs text-neutral-400">
                  Rankings dynamically calculated from actual stored evaluation records across Accuracy (40%), Completion (25%), Reliability (15%), Speed (10%), and Cost Efficiency (10%).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Language Filter */}
                <div className="flex items-center space-x-1.5 bg-neutral-950 px-2.5 py-1.5 rounded-lg border border-neutral-800 text-xs">
                  <span className="text-neutral-500 text-[11px]">Lang:</span>
                  <select
                    value={leaderboardLang}
                    onChange={(e) => {
                      setLeaderboardLang(e.target.value);
                      fetchLeaderboard(e.target.value, leaderboardCat);
                    }}
                    className="bg-transparent text-neutral-200 text-xs focus:outline-none cursor-pointer"
                  >
                    <option value="ALL" className="bg-neutral-900">All Languages</option>
                    <option value="python" className="bg-neutral-900">Python</option>
                    <option value="typescript" className="bg-neutral-900">TypeScript</option>
                    <option value="javascript" className="bg-neutral-900">JavaScript</option>
                    <option value="rust" className="bg-neutral-900">Rust</option>
                    <option value="go" className="bg-neutral-900">Go</option>
                  </select>
                </div>

                {/* Category Filter */}
                <div className="flex items-center space-x-1.5 bg-neutral-950 px-2.5 py-1.5 rounded-lg border border-neutral-800 text-xs">
                  <span className="text-neutral-500 text-[11px]">Category:</span>
                  <select
                    value={leaderboardCat}
                    onChange={(e) => {
                      setLeaderboardCat(e.target.value);
                      fetchLeaderboard(leaderboardLang, e.target.value);
                    }}
                    className="bg-transparent text-neutral-200 text-xs focus:outline-none cursor-pointer"
                  >
                    <option value="ALL" className="bg-neutral-900">All Categories</option>
                    <option value="Algorithms" className="bg-neutral-900">Algorithms</option>
                    <option value="String Manipulation" className="bg-neutral-900">String Manipulation</option>
                    <option value="Arrays & Hash Maps" className="bg-neutral-900">Arrays & Hash Maps</option>
                  </select>
                </div>

                <button
                  onClick={() => fetchLeaderboard(leaderboardLang, leaderboardCat)}
                  className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition cursor-pointer"
                  title="Refresh Leaderboard"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Leaderboard Table */}
            {leaderboard.length === 0 ? (
              <div className="text-center py-12 bg-neutral-900/30 rounded-xl border border-neutral-800 space-y-3">
                <Trophy className="w-10 h-10 text-neutral-600 mx-auto" />
                <h3 className="font-semibold text-neutral-200 text-sm">No Evaluated Agents in Selected Filter</h3>
                <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                  Run a benchmark battle between registered agents and compute Stage 5 evaluations to populate the deterministic leaderboard.
                </p>
                <div className="pt-2 flex justify-center gap-2">
                  <button
                    onClick={() => { setLeaderboardLang('ALL'); setLeaderboardCat('ALL'); fetchLeaderboard('ALL', 'ALL'); }}
                    className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300 transition cursor-pointer"
                  >
                    Reset Filters
                  </button>
                  <button
                    onClick={() => openNewRunWizard()}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-neutral-950 font-semibold text-xs transition cursor-pointer"
                  >
                    Launch Battle
                  </button>
                </div>
              </div>
            ) : (
              <div className="border border-neutral-800 rounded-xl bg-neutral-900/40 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-neutral-950/80 border-b border-neutral-800 text-neutral-400 font-mono text-[11px] uppercase tracking-wider">
                      <tr>
                        <th className="py-3 px-4">Rank</th>
                        <th className="py-3 px-4">Agent</th>
                        <th className="py-3 px-4">Overall Score</th>
                        <th className="py-3 px-4">Accuracy (40%)</th>
                        <th className="py-3 px-4">Completion (25%)</th>
                        <th className="py-3 px-4">Reliability (15%)</th>
                        <th className="py-3 px-4">Speed (10%)</th>
                        <th className="py-3 px-4">Cost (10%)</th>
                        <th className="py-3 px-4 text-center">Win Rate</th>
                        <th className="py-3 px-4 text-right">Runs</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/80 font-mono">
                      {leaderboard.map((entry) => (
                        <tr
                          key={entry.agentId}
                          className="hover:bg-neutral-800/40 transition group"
                        >
                          {/* Rank Badge */}
                          <td className="py-3.5 px-4 font-bold">
                            {entry.rank === 1 ? (
                              <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-950/80 text-amber-300 border border-amber-600/80 shadow-sm shadow-amber-500/20">
                                <Trophy className="w-3.5 h-3.5 text-amber-400 fill-current" />
                                <span>#1</span>
                              </span>
                            ) : entry.rank === 2 ? (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-200 border border-neutral-600">
                                <span>#2</span>
                              </span>
                            ) : entry.rank === 3 ? (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-950/30 text-amber-600 border border-amber-900">
                                <span>#3</span>
                              </span>
                            ) : (
                              <span className="text-neutral-500 pl-2">#{entry.rank}</span>
                            )}
                          </td>

                          {/* Agent Name & Languages */}
                          <td className="py-3.5 px-4 font-sans">
                            <div className="font-semibold text-neutral-100 group-hover:text-cyan-300 transition text-sm">
                              {entry.agentName}
                            </div>
                            <div className="flex items-center space-x-1.5 mt-1 font-mono text-[10px] text-neutral-500">
                              <span className="px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-400">v{entry.version}</span>
                              <span>•</span>
                              <div className="flex flex-wrap gap-1">
                                {entry.supportedLanguages.slice(0, 3).map((l) => (
                                  <span key={l} className="text-neutral-400">{l}</span>
                                ))}
                                {entry.supportedLanguages.length > 3 && (
                                  <span className="text-neutral-600">+{entry.supportedLanguages.length - 3}</span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Overall Score with mini meter */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center space-x-2">
                              <span className="text-base font-black text-cyan-400">
                                {entry.overallScore}
                              </span>
                              <span className="text-[11px] text-neutral-500">/100</span>
                            </div>
                            <div className="w-20 h-1.5 bg-neutral-900 rounded-full overflow-hidden mt-1">
                              <div
                                className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-full"
                                style={{ width: `${entry.overallScore}%` }}
                              />
                            </div>
                          </td>

                          {/* Metric breakdown */}
                          <td className="py-3.5 px-4 text-neutral-300">
                            <span className="font-semibold text-cyan-300">{entry.accuracyScore}%</span>
                          </td>
                          <td className="py-3.5 px-4 text-neutral-300">
                            <span className="font-semibold text-emerald-300">{entry.completionScore}%</span>
                          </td>
                          <td className="py-3.5 px-4 text-neutral-300">
                            <span className="font-semibold text-indigo-300">{entry.reliabilityScore}%</span>
                          </td>
                          <td className="py-3.5 px-4 text-neutral-300">
                            <span className="font-semibold text-amber-300">{entry.speedScore}%</span>
                          </td>
                          <td className="py-3.5 px-4 text-neutral-300">
                            {entry.costEfficiencyScore !== null ? (
                              <span className="font-semibold text-purple-300">{entry.costEfficiencyScore}%</span>
                            ) : (
                              <span className="text-neutral-500 text-[11px]">N/A (Re-norm)</span>
                            )}
                          </td>

                          {/* Win Rate */}
                          <td className="py-3.5 px-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              entry.successRate >= 80
                                ? 'bg-emerald-950 text-emerald-400'
                                : entry.successRate >= 50
                                ? 'bg-amber-950 text-amber-300'
                                : 'bg-rose-950 text-rose-300'
                            }`}>
                              {entry.successRate}%
                            </span>
                          </td>

                          {/* Total Runs */}
                          <td className="py-3.5 px-4 text-right text-neutral-400">
                            <span>{entry.totalEvaluatedRuns}</span>
                            <span className="text-neutral-600 text-[11px]"> / {entry.totalExecutions}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: ANALYTICS (Stage 6) */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* Analytics Header */}
            <div className="flex items-center justify-between bg-neutral-900/60 p-4 rounded-xl border border-neutral-800">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <BarChart3 className="w-5 h-5 text-cyan-400" />
                  <h2 className="text-base font-bold text-white tracking-tight">Arena Evaluation & Performance Analytics</h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-800/80">
                    Stage 6 Aggregations
                  </span>
                </div>
                <p className="text-xs text-neutral-400">
                  Comprehensive performance, reliability, execution speed, and token efficiency statistics across all benchmark runs.
                </p>
              </div>

              <button
                onClick={() => fetchAnalytics()}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300 hover:text-white transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Analytics</span>
              </button>
            </div>

            {/* 6 Key KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3.5">
                <span className="text-[11px] text-neutral-400 font-medium">Benchmark Runs</span>
                <div className="text-xl font-bold text-white mt-1">{analytics?.totalBenchmarkRuns || runs.length}</div>
                <span className="text-[10px] text-neutral-500">Battle suites</span>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3.5">
                <span className="text-[11px] text-neutral-400 font-medium">Total Executions</span>
                <div className="text-xl font-bold text-amber-400 mt-1">{analytics?.totalExecutions || 0}</div>
                <span className="text-[10px] text-neutral-500">Agent attempts</span>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3.5">
                <span className="text-[11px] text-neutral-400 font-medium">Evaluated</span>
                <div className="text-xl font-bold text-cyan-400 mt-1">{analytics?.totalEvaluatedExecutions || 0}</div>
                <span className="text-[10px] text-neutral-500">Stage 5 scored</span>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3.5">
                <span className="text-[11px] text-neutral-400 font-medium">Success Rate</span>
                <div className="text-xl font-bold text-emerald-400 mt-1">{analytics?.overallSuccessRate || 0}%</div>
                <span className="text-[10px] text-neutral-500">Crash-free runs</span>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3.5">
                <span className="text-[11px] text-neutral-400 font-medium">Avg Execution</span>
                <div className="text-xl font-bold text-indigo-400 mt-1">{analytics?.averageDurationMs || 0}ms</div>
                <span className="text-[10px] text-neutral-500">Response latency</span>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3.5">
                <span className="text-[11px] text-neutral-400 font-medium">Avg Score</span>
                <div className="text-xl font-bold text-purple-400 mt-1">{analytics?.averageOverallScore || 0}<span className="text-xs text-neutral-500 font-normal">/100</span></div>
                <span className="text-[10px] text-neutral-500">Weighted grade</span>
              </div>
            </div>

            {/* Category & Language Breakdowns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Category Breakdown */}
              <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <PieChart className="w-4 h-4 text-cyan-400" />
                    <h3 className="font-semibold text-xs text-white uppercase tracking-wider">Performance by Task Category</h3>
                  </div>
                  <span className="text-[10px] text-neutral-500 font-mono">Aggregated</span>
                </div>

                <div className="space-y-3">
                  {analytics && Object.keys(analytics.categoryBreakdown).length > 0 ? (
                    Object.entries(analytics.categoryBreakdown).map(([cat, data]) => (
                      <div key={cat} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-300 font-medium">{cat}</span>
                          <span className="text-neutral-400 font-mono">
                            {data.avgScore > 0 ? `${data.avgScore}/100` : 'Unscored'} ({data.count} runs)
                          </span>
                        </div>
                        <div className="h-1.5 bg-neutral-950 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-cyan-500 rounded-full"
                            style={{ width: `${data.avgScore}%` }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-neutral-500 text-xs py-4 text-center">No category evaluations recorded</div>
                  )}
                </div>
              </div>

              {/* Language Breakdown */}
              <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <FileCode2 className="w-4 h-4 text-indigo-400" />
                    <h3 className="font-semibold text-xs text-white uppercase tracking-wider">Performance by Language</h3>
                  </div>
                  <span className="text-[10px] text-neutral-500 font-mono">Normalized</span>
                </div>

                <div className="space-y-3">
                  {analytics && Object.keys(analytics.languageBreakdown).length > 0 ? (
                    Object.entries(analytics.languageBreakdown).map(([lang, data]) => (
                      <div key={lang} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-300 font-medium capitalize">{lang}</span>
                          <span className="text-neutral-400 font-mono">
                            {data.avgScore > 0 ? `${data.avgScore}/100` : 'Unscored'} ({data.count} runs)
                          </span>
                        </div>
                        <div className="h-1.5 bg-neutral-950 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 rounded-full"
                            style={{ width: `${data.avgScore}%` }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-neutral-500 text-xs py-4 text-center">No language evaluations recorded</div>
                  )}
                </div>
              </div>
            </div>

            {/* Recent Evaluations History Feed */}
            <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <h3 className="font-semibold text-xs text-white uppercase tracking-wider">Recent Evaluation Records</h3>
                </div>
                <span className="text-[10px] text-neutral-500 font-mono">Deterministic History</span>
              </div>

              {analytics && analytics.recentEvaluations.length > 0 ? (
                <div className="divide-y divide-neutral-800/80">
                  {analytics.recentEvaluations.map((ev, i) => (
                    <div key={i} className="py-2.5 flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        <div>
                          <div className="font-medium text-neutral-200">
                            {ev.agentName} on <span className="text-cyan-300">{ev.taskTitle}</span>
                          </div>
                          <span className="text-[10px] text-neutral-500 font-mono">
                            {new Date(ev.evaluatedAt).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3 font-mono">
                        <span className="text-sm font-bold text-cyan-400">{ev.overallScore}<span className="text-neutral-500 text-[10px]">/100</span></span>
                        <button
                          onClick={() => {
                            const r = runs.find(run => run.id === ev.runId);
                            if (r) {
                              setViewingRun(r);
                              setActiveTab('runs');
                            }
                          }}
                          className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px] transition cursor-pointer"
                        >
                          View Battle
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-neutral-500 text-xs py-4 text-center">No recent evaluations recorded</div>
              )}
            </div>
          </div>
        )}

        {/* TAB: INFRASTRUCTURE (Stage 7) */}
        {activeTab === 'infrastructure' && (
          <div className="space-y-6">
            {/* Infrastructure Header */}
            <div className="flex items-center justify-between bg-neutral-900/60 p-4 rounded-xl border border-neutral-800">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <Cpu className="w-5 h-5 text-emerald-400" />
                  <h2 className="text-base font-bold text-white tracking-tight">Stage 7 Advanced Infrastructure Stack</h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800/80">
                    Docker • Redis • BullMQ • Bifrost
                  </span>
                </div>
                <p className="text-xs text-neutral-400">
                  Isolated execution environments, background queues, idempotent job tracking, and unified model provider integration.
                </p>
              </div>

              <button
                onClick={() => fetchInfrastructure()}
                disabled={loadingInfra}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300 hover:text-white transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingInfra ? 'animate-spin' : ''}`} />
                <span>Refresh Status</span>
              </button>
            </div>

            {/* 4 Infrastructure Pillar Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Pillar 1: Docker Sandbox */}
              <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <Box className="w-5 h-5 text-blue-400" />
                    <div>
                      <h3 className="font-bold text-sm text-white">Docker Container Sandbox</h3>
                      <p className="text-[11px] text-neutral-400">Isolated Execution & Process Hardening</p>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                      infraStatus?.docker.status === 'AVAILABLE'
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : 'bg-amber-950 text-amber-300 border-amber-800'
                    }`}
                  >
                    {infraStatus?.docker.status || 'CHECKING'}
                  </span>
                </div>

                <p className="text-xs text-neutral-400">
                  {infraStatus?.docker.reason || 'Probing Docker socket /var/run/docker.sock and CLI daemon availability...'}
                </p>

                {/* Security Matrix */}
                <div className="space-y-2 bg-neutral-950/70 p-3.5 rounded-lg border border-neutral-800/80 text-xs font-mono">
                  <div className="text-[11px] font-sans font-bold text-neutral-300 uppercase tracking-wider mb-1">
                    Enforced Sandbox Security Profile
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="flex items-center space-x-1.5 text-neutral-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Non-Root User (1000:1000)</span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-neutral-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Network Disabled (--network=none)</span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-neutral-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Read-Only Root Filesystem</span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-neutral-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Memory Cap: 512MB</span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-neutral-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>CPU Cap: 1.0 core</span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-neutral-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Drop Capabilities (--cap-drop=ALL)</span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-neutral-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>PID Limit: 64 processes</span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-neutral-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Container Auto-Remove (--rm)</span>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-neutral-500 italic">
                  Note: In sandbox/container dev environments without root host daemon access, fallback uses direct execution with strict timeout & size guards. Untrusted code is never executed directly on the host server.
                </div>
              </div>

              {/* Pillar 2: Redis State Broker */}
              <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <Database className="w-5 h-5 text-rose-400" />
                    <div>
                      <h3 className="font-bold text-sm text-white">Redis In-Memory State Broker</h3>
                      <p className="text-[11px] text-neutral-400">Queue Storage & Atomic Counters</p>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                      infraStatus?.redis.status === 'CONNECTED'
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : 'bg-amber-950 text-amber-300 border-amber-800'
                    }`}
                  >
                    {infraStatus?.redis.status || 'CHECKING'}
                  </span>
                </div>

                <div className="space-y-2 bg-neutral-950/70 p-3.5 rounded-lg border border-neutral-800/80 text-xs font-mono">
                  <div className="flex justify-between py-1 border-b border-neutral-900">
                    <span className="text-neutral-500">Host / Target:</span>
                    <span className="text-neutral-200">{infraStatus?.redis.host || '127.0.0.1'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-900">
                    <span className="text-neutral-500">Port:</span>
                    <span className="text-neutral-200">{infraStatus?.redis.port || 6379}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-900">
                    <span className="text-neutral-500">Ping Latency:</span>
                    <span className="text-neutral-200">
                      {infraStatus?.redis.latencyMs !== null && infraStatus?.redis.latencyMs !== undefined
                        ? `${infraStatus.redis.latencyMs}ms`
                        : 'Offline / Unreachable'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-neutral-500">Environment Vars:</span>
                    <span className="text-neutral-400 text-[10px]">REDIS_HOST, REDIS_PORT, REDIS_PASSWORD</span>
                  </div>
                </div>

                <p className="text-[11px] text-neutral-400">
                  {infraStatus?.redis.error
                    ? `Status detail: ${infraStatus.redis.error}`
                    : 'Redis connection verified. In-memory queue storage active.'}
                </p>
              </div>

              {/* Pillar 3: BullMQ Queue */}
              <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <Layers className="w-5 h-5 text-amber-400" />
                    <div>
                      <h3 className="font-bold text-sm text-white">BullMQ Background Queue</h3>
                      <p className="text-[11px] text-neutral-400">Controlled Concurrency & Idempotency</p>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                      infraStatus?.bullmq.status === 'ACTIVE'
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                    }`}
                  >
                    {infraStatus?.bullmq.status || 'OFFLINE'}
                  </span>
                </div>

                {/* Queue Stats Matrix */}
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800">
                    <span className="text-[10px] text-neutral-500 font-mono block">Active</span>
                    <span className="text-base font-bold text-cyan-400 font-mono">{infraStatus?.bullmq.activeJobs || 0}</span>
                  </div>
                  <div className="bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800">
                    <span className="text-[10px] text-neutral-500 font-mono block">Waiting</span>
                    <span className="text-base font-bold text-amber-400 font-mono">{infraStatus?.bullmq.waitingJobs || 0}</span>
                  </div>
                  <div className="bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800">
                    <span className="text-[10px] text-neutral-500 font-mono block">Completed</span>
                    <span className="text-base font-bold text-emerald-400 font-mono">{infraStatus?.bullmq.completedJobs || 0}</span>
                  </div>
                  <div className="bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800">
                    <span className="text-[10px] text-neutral-500 font-mono block">Failed</span>
                    <span className="text-base font-bold text-rose-400 font-mono">{infraStatus?.bullmq.failedJobs || 0}</span>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-neutral-400 bg-neutral-950/50 p-3 rounded-lg border border-neutral-800/80">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-neutral-500">Queue Name:</span>
                    <span className="text-neutral-300">benchmark-execution</span>
                  </div>
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-neutral-500">Concurrency:</span>
                    <span className="text-neutral-300">5 parallel workers</span>
                  </div>
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-neutral-500">Idempotency:</span>
                    <span className="text-emerald-400">jobId = runId (Enforced)</span>
                  </div>
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-neutral-500">Retry Policy:</span>
                    <span className="text-neutral-300">Exponential backoff (2 attempts)</span>
                  </div>
                </div>
              </div>

              {/* Pillar 4: Bifrost Model Gateway */}
              <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <Network className="w-5 h-5 text-purple-400" />
                    <div>
                      <h3 className="font-bold text-sm text-white">Bifrost Unified Model Gateway</h3>
                      <p className="text-[11px] text-neutral-400">Multi-Provider LLM Integration</p>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                      infraStatus?.bifrost.status === 'CONFIGURED'
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                    }`}
                  >
                    {infraStatus?.bifrost.status || 'NOT_CONFIGURED'}
                  </span>
                </div>

                <div className="space-y-2 bg-neutral-950/70 p-3.5 rounded-lg border border-neutral-800/80 text-xs font-mono">
                  <div className="flex justify-between py-1 border-b border-neutral-900">
                    <span className="text-neutral-500">Endpoint:</span>
                    <span className="text-neutral-200 truncate max-w-[200px]">
                      {infraStatus?.bifrost.endpoint || 'Unconfigured (BIFROST_ENDPOINT)'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-900">
                    <span className="text-neutral-500">API Key:</span>
                    <span className={infraStatus?.bifrost.hasApiKey ? 'text-emerald-400' : 'text-neutral-500'}>
                      {infraStatus?.bifrost.hasApiKey ? 'Configured (Redacted)' : 'Missing (BIFROST_API_KEY)'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-900">
                    <span className="text-neutral-500">Request Timeout:</span>
                    <span className="text-neutral-200">30,000ms (AbortController)</span>
                  </div>
                  <div className="py-1">
                    <span className="text-neutral-500 block mb-1">Supported Providers:</span>
                    <div className="flex flex-wrap gap-1">
                      {['OpenAI', 'Anthropic', 'DeepSeek', 'Google', 'Custom'].map((p) => (
                        <span key={p} className="px-1.5 py-0.5 rounded bg-neutral-900 text-neutral-300 text-[10px]">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-neutral-400">
                  Unified model gateway integrates external LLM providers with server-side credential isolation and token usage telemetry.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 1: BENCHMARK TASKS */}
        {activeTab === 'tasks' && (
          <div className="space-y-4">
            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-neutral-900/40 p-3 rounded-xl border border-neutral-800">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search benchmark tasks by title or problem statement..."
                  value={taskSearch}
                  onChange={e => setTaskSearch(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg pl-9 pr-4 py-2 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center space-x-2">
                <select
                  value={taskDifficultyFilter}
                  onChange={e => setTaskDifficultyFilter(e.target.value)}
                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-300"
                >
                  <option value="ALL">All Difficulties</option>
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>

                <select
                  value={taskLanguageFilter}
                  onChange={e => setTaskLanguageFilter(e.target.value)}
                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-300"
                >
                  <option value="ALL">All Languages</option>
                  {COMMON_LANGUAGES.map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>

                <button
                  onClick={fetchData}
                  className="p-2 text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800 rounded-lg"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Tasks Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredTasks.map(task => (
                <div
                  key={task.id}
                  className="bg-neutral-900/60 border border-neutral-800 hover:border-neutral-700 rounded-xl p-5 flex flex-col justify-between transition group"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-semibold text-sm text-neutral-100 group-hover:text-cyan-300 transition">
                            {task.title}
                          </h3>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                              task.difficulty === 'EASY'
                                ? 'bg-emerald-950/70 text-emerald-400 border-emerald-800/60'
                                : task.difficulty === 'MEDIUM'
                                ? 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                                : 'bg-rose-950/70 text-rose-300 border-rose-800/60'
                            }`}
                          >
                            {task.difficulty}
                          </span>
                        </div>
                        <span className="text-[11px] text-neutral-500 font-mono">{task.category}</span>
                      </div>

                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-cyan-300 border border-neutral-700/50">
                        {task.language}
                      </span>
                    </div>

                    <p className="text-xs text-neutral-300 line-clamp-3 mb-4 leading-relaxed">
                      {task.description}
                    </p>

                    {/* Constraints */}
                    <div className="flex items-center space-x-4 text-[11px] font-mono text-neutral-400 bg-neutral-950/60 border border-neutral-800/70 p-2 rounded-lg mb-4">
                      <div className="flex items-center space-x-1">
                        <Clock className="w-3.5 h-3.5 text-neutral-500" />
                        <span>Timeout: <strong className="text-neutral-200">{task.timeoutSeconds}s</strong></span>
                      </div>
                      <div>
                        <span>Max Output: <strong className="text-neutral-200">{Math.round(task.maxOutputSizeBytes / 1000)}KB</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-3 border-t border-neutral-800 flex items-center justify-between">
                    <button
                      onClick={() => openNewRunWizard(task.id)}
                      className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-amber-950/80 hover:bg-amber-900/90 text-amber-300 border border-amber-800/70 text-xs font-semibold transition"
                    >
                      <Flame className="w-3.5 h-3.5 fill-current" />
                      <span>Launch Battle</span>
                    </button>

                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => openTaskModal(task)}
                        className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white"
                        title="Edit task"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteTask(task.id, task.title)}
                        className="p-1.5 rounded hover:bg-rose-950/50 text-neutral-500 hover:text-rose-400"
                        title="Delete task"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: ARENA BATTLES & RUNS */}
        {activeTab === 'runs' && (
          <div className="space-y-6">
            {/* If a run is selected, show its live execution monitor */}
            {viewingRun ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between bg-neutral-900 border border-neutral-800 p-4 rounded-xl">
                  <div>
                    <button
                      onClick={() => setViewingRun(null)}
                      className="text-xs text-neutral-400 hover:text-white mb-1 flex items-center space-x-1"
                    >
                      <span>← Back to all battle runs</span>
                    </button>
                    <div className="flex items-center space-x-3">
                      <h2 className="text-base font-bold text-white">{viewingRun.title}</h2>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                          viewingRun.status === 'COMPLETED'
                            ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                            : viewingRun.status === 'RUNNING'
                            ? 'bg-cyan-950 text-cyan-300 border-cyan-800 animate-pulse'
                            : viewingRun.status === 'PARTIALLY_FAILED'
                            ? 'bg-amber-950 text-amber-300 border-amber-800'
                            : 'bg-rose-950 text-rose-300 border-rose-800'
                        }`}
                      >
                        {viewingRun.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-neutral-400">
                    <div>
                      Task: <strong className="text-cyan-300">{viewingRun.taskTitle}</strong> ({viewingRun.taskLanguage})
                    </div>
                    {viewingRun.durationMs && (
                      <div>
                        Total Duration: <strong className="text-white">{viewingRun.durationMs}ms</strong>
                      </div>
                    )}
                    <div className="flex items-center space-x-1.5 ml-2">
                      <button
                        onClick={() => handleExportReport(viewingRun.id, 'csv')}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 text-[11px] font-sans font-medium transition cursor-pointer"
                        title="Export CSV report"
                      >
                        <Download className="w-3 h-3 text-emerald-400" />
                        <span>CSV</span>
                      </button>
                      <button
                        onClick={() => handleExportReport(viewingRun.id, 'json')}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 text-[11px] font-sans font-medium transition cursor-pointer"
                        title="Export JSON report"
                      >
                        <Download className="w-3 h-3 text-cyan-400" />
                        <span>JSON</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* STAGE 5: EVALUATION ENGINE & SCORING PANEL */}
                {viewingRun.status !== 'RUNNING' && viewingRun.status !== 'QUEUED' && (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                      <div className="flex items-center space-x-2">
                        <BarChart3 className="w-4 h-4 text-cyan-400" />
                        <h3 className="font-bold text-sm text-white">Stage 5 Performance Evaluation & Scoring</h3>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-neutral-400">
                          v1.0.0 Standard
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {evaluations.length > 0 ? (
                          <button
                            onClick={() => handleEvaluateRun(true)}
                            disabled={isEvaluating}
                            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isEvaluating ? 'animate-spin' : ''}`} />
                            <span>Recalculate</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleEvaluateRun(false)}
                            disabled={isEvaluating}
                            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition shadow-sm shadow-cyan-600/30"
                          >
                            {isEvaluating ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Zap className="w-3.5 h-3.5 text-amber-300" />
                            )}
                            <span>Run Stage 5 Evaluation</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {evaluations.length === 0 ? (
                      <div className="p-4 rounded-lg bg-neutral-950/60 border border-neutral-800/80 text-xs text-neutral-400 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-neutral-200 mb-0.5">Execution Completed — Awaiting Evaluation</p>
                          <p className="text-[11px] text-neutral-500">
                            Run the deterministic evaluation engine to calculate weighted scores for Accuracy (40%), Completion (25%), Reliability (15%), Speed (10%), and Cost (10%).
                          </p>
                        </div>
                        <button
                          onClick={() => handleEvaluateRun(false)}
                          disabled={isEvaluating}
                          className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition shrink-0 ml-4"
                        >
                          Evaluate Now
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Agent Comparison Table */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {evaluations.map((ev, idx) => (
                            <div
                              key={ev.id}
                              className="bg-neutral-950 border border-neutral-800/90 rounded-xl p-4 flex flex-col justify-between"
                            >
                              <div>
                                <div className="flex items-start justify-between mb-2">
                                  <div>
                                    <div className="flex items-center space-x-2">
                                      <span className="font-bold text-sm text-neutral-100">{ev.agentName}</span>
                                      {idx === 0 && ev.overallScore > 0 && (
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/80">
                                          Top Performer
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-neutral-500 font-mono">
                                      {ev.passedTestCount}/{ev.totalTestCount} test cases passed
                                    </span>
                                  </div>

                                  <div className="text-right">
                                    <div className="text-xl font-black text-cyan-400 font-mono">
                                      {ev.overallScore}<span className="text-xs text-neutral-500 font-normal">/100</span>
                                    </div>
                                    <span className="text-[10px] text-neutral-400 font-medium">Overall Score</span>
                                  </div>
                                </div>

                                {/* Metric Breakdown Progress Bars */}
                                <div className="space-y-1.5 my-3 text-xs font-mono">
                                  <div>
                                    <div className="flex justify-between text-[11px] mb-0.5 text-neutral-400">
                                      <span>Accuracy (40%)</span>
                                      <span className="text-neutral-200">{ev.accuracyScore}%</span>
                                    </div>
                                    <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden">
                                      <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${ev.accuracyScore}%` }} />
                                    </div>
                                  </div>

                                  <div>
                                    <div className="flex justify-between text-[11px] mb-0.5 text-neutral-400">
                                      <span>Task Completion (25%)</span>
                                      <span className="text-neutral-200">{ev.completionScore}%</span>
                                    </div>
                                    <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden">
                                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${ev.completionScore}%` }} />
                                    </div>
                                  </div>

                                  <div>
                                    <div className="flex justify-between text-[11px] mb-0.5 text-neutral-400">
                                      <span>Reliability (15%)</span>
                                      <span className="text-neutral-200">{ev.reliabilityScore}%</span>
                                    </div>
                                    <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden">
                                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${ev.reliabilityScore}%` }} />
                                    </div>
                                  </div>

                                  <div>
                                    <div className="flex justify-between text-[11px] mb-0.5 text-neutral-400">
                                      <span>Execution Speed (10%)</span>
                                      <span className="text-neutral-200">{ev.speedScore}%</span>
                                    </div>
                                    <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden">
                                      <div className="h-full bg-amber-500 rounded-full" style={{ width: `${ev.speedScore}%` }} />
                                    </div>
                                  </div>

                                  <div>
                                    <div className="flex justify-between text-[11px] mb-0.5 text-neutral-400">
                                      <span>Cost Efficiency (10%)</span>
                                      <span className="text-neutral-200">
                                        {ev.costEfficiencyScore !== null ? `${ev.costEfficiencyScore}%` : 'N/A (Re-normalized)'}
                                      </span>
                                    </div>
                                    <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-purple-500 rounded-full"
                                        style={{ width: `${ev.costEfficiencyScore !== null ? ev.costEfficiencyScore : 0}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="pt-2 border-t border-neutral-900 flex justify-end">
                                <button
                                  onClick={() => setSelectedEvalDetail(ev)}
                                  className="text-xs text-cyan-400 hover:text-cyan-300 font-medium flex items-center space-x-1"
                                >
                                  <span>Inspect Breakdown & Test Cases</span>
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Individual Agent Execution Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {viewingRun.executions.map(exec => (
                    <div
                      key={exec.id}
                      className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-5 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-bold text-sm text-white">{exec.agentName}</h3>
                            <span className="text-[10px] text-neutral-500 font-mono truncate max-w-xs block">
                              {exec.agentEndpoint}
                            </span>
                          </div>

                          {/* Execution Status Badge */}
                          <span
                            className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                              exec.status === 'COMPLETED'
                                ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                                : exec.status === 'RUNNING'
                                ? 'bg-cyan-950 text-cyan-300 border-cyan-800 animate-pulse'
                                : exec.status === 'TIMED_OUT'
                                ? 'bg-amber-950 text-amber-300 border-amber-800'
                                : 'bg-rose-950 text-rose-300 border-rose-800'
                            }`}
                          >
                            {exec.status}
                          </span>
                        </div>

                        {/* Timing and Token Metrics */}
                        <div className="grid grid-cols-3 gap-2 bg-neutral-950 border border-neutral-800 p-2.5 rounded-lg text-xs font-mono mb-4 text-neutral-400">
                          <div>
                            <span className="text-[10px] text-neutral-500 block">Duration</span>
                            <span className="text-cyan-300">{exec.durationMs ? `${exec.durationMs}ms` : '—'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-neutral-500 block">Input Tokens</span>
                            <span className="text-neutral-200">{exec.inputTokens ?? 'null'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-neutral-500 block">Output Tokens</span>
                            <span className="text-neutral-200">{exec.outputTokens ?? 'null'}</span>
                          </div>
                        </div>

                        {/* Error Message if Failed */}
                        {exec.errorMessage && (
                          <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300 mb-4">
                            <strong>Execution Error:</strong> {exec.errorMessage}
                          </div>
                        )}

                        {/* Generated Output Code */}
                        {exec.rawOutput ? (
                          <div>
                            <span className="text-xs font-medium text-neutral-400 block mb-1">
                              Agent Code Output:
                            </span>
                            <pre className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-xs font-mono text-neutral-200 overflow-x-auto max-h-60 leading-relaxed">
                              {exec.rawOutput}
                            </pre>
                          </div>
                        ) : (
                          <div className="text-xs text-neutral-500 italic p-3 text-center bg-neutral-950/40 rounded-lg border border-neutral-800/50">
                            {exec.status === 'RUNNING' ? 'Agent is synthesizing solution...' : 'No output returned.'}
                          </div>
                        )}
                      </div>

                      <div className="pt-3 border-t border-neutral-800/80 mt-4 text-[10px] font-mono text-neutral-500 flex justify-between">
                        <span>Request ID: {exec.requestId}</span>
                        {exec.completedAt && (
                          <span>Finished {new Date(exec.completedAt).toLocaleTimeString()}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* All Runs Listing */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Benchmark Battle History</h2>
                  <button
                    onClick={() => openNewRunWizard()}
                    className="inline-flex items-center space-x-1.5 bg-amber-600 hover:bg-amber-500 text-neutral-950 font-semibold text-xs px-3 py-1.5 rounded-lg transition"
                  >
                    <Flame className="w-3.5 h-3.5 fill-current" />
                    <span>Launch New Battle</span>
                  </button>
                </div>

                {runs.length === 0 ? (
                  <div className="border border-neutral-800 rounded-2xl bg-neutral-900/30 p-12 text-center">
                    <Swords className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
                    <h3 className="text-sm font-semibold text-neutral-300">No benchmark runs yet</h3>
                    <p className="text-xs text-neutral-500 max-w-sm mx-auto mt-1 mb-4">
                      Launch a battle by selecting a benchmark task and dispatching it to at least two registered agents.
                    </p>
                    <button
                      onClick={() => openNewRunWizard()}
                      className="inline-flex items-center space-x-1.5 bg-amber-600 hover:bg-amber-500 text-neutral-950 font-semibold text-xs px-4 py-2 rounded-lg transition"
                    >
                      <Flame className="w-3.5 h-3.5 fill-current" />
                      <span>Launch First Battle</span>
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-800 border border-neutral-800 rounded-xl bg-neutral-900/40 overflow-hidden">
                    {runs.map(run => (
                      <div
                        key={run.id}
                        onClick={() => setViewingRun(run)}
                        className="p-4 hover:bg-neutral-800/50 cursor-pointer flex items-center justify-between transition group"
                      >
                        <div className="flex items-center space-x-3">
                          <div
                            className={`w-2.5 h-2.5 rounded-full ${
                              run.status === 'COMPLETED'
                                ? 'bg-emerald-400'
                                : run.status === 'RUNNING'
                                ? 'bg-cyan-400 animate-pulse'
                                : run.status === 'PARTIALLY_FAILED'
                                ? 'bg-amber-400'
                                : 'bg-rose-400'
                            }`}
                          />
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-semibold text-sm text-neutral-100 group-hover:text-cyan-300 transition">
                                {run.title}
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-neutral-400">
                                {run.taskLanguage}
                              </span>
                            </div>
                            <div className="text-xs text-neutral-500 mt-0.5">
                              Task: {run.taskTitle} • {run.executions.length} Agents competing
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-4 text-xs font-mono">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              run.status === 'COMPLETED'
                                ? 'bg-emerald-950 text-emerald-400'
                                : run.status === 'RUNNING'
                                ? 'bg-cyan-950 text-cyan-300'
                                : run.status === 'PARTIALLY_FAILED'
                                ? 'bg-amber-950 text-amber-300'
                                : 'bg-rose-950 text-rose-300'
                            }`}
                          >
                            {run.status}
                          </span>
                          <span className="text-neutral-500">
                            {new Date(run.createdAt).toLocaleTimeString()}
                          </span>
                          <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleExportReport(run.id, 'csv')}
                              className="px-2 py-0.5 text-[11px] text-neutral-400 hover:text-emerald-300 hover:bg-neutral-800 rounded border border-neutral-800 transition flex items-center space-x-1"
                              title="Export CSV"
                            >
                              <Download className="w-3 h-3 text-emerald-400" />
                              <span>CSV</span>
                            </button>
                          </div>
                          <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-cyan-400 transition" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: AGENTS (Stage 3 Integration) */}
        {activeTab === 'registry' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-neutral-900/40 p-3 rounded-xl border border-neutral-800">
              <h2 className="text-sm font-semibold text-white">Registered Benchmark Agents</h2>
              <button
                onClick={() => setIsRegisterOpen(true)}
                className="inline-flex items-center space-x-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Register Agent</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agents.map(agent => (
                <div
                  key={agent.id}
                  className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-semibold text-sm text-neutral-100">{agent.name}</h3>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
                            v{agent.version}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-400 mt-1 line-clamp-2">{agent.description}</p>
                      </div>

                      <span
                        className={`text-[10px] font-medium px-2.5 py-1 rounded-full border ${
                          agent.connectionStatus === 'CONNECTED'
                            ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60'
                            : agent.connectionStatus === 'UNTESTED'
                            ? 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                            : 'bg-rose-950/80 text-rose-300 border-rose-800/60'
                        }`}
                      >
                        {agent.connectionStatus}
                      </span>
                    </div>

                    <div className="bg-neutral-950 border border-neutral-800/80 rounded px-2.5 py-1.5 my-3 text-xs font-mono text-neutral-400 truncate">
                      {agent.endpoint}
                    </div>

                    <div className="flex flex-wrap gap-1 mb-4">
                      {agent.supportedLanguages.map(l => (
                        <span key={l} className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-cyan-300">
                          {l}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-neutral-800 flex items-center justify-between">
                    <span className="text-[11px] text-neutral-500 font-mono">
                      {agent.hasAuthSecret ? 'AES-256 Auth' : 'Public'}
                    </span>
                    <button
                      onClick={() => handleTestAgent(agent)}
                      className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs flex items-center space-x-1"
                    >
                      <Zap className="w-3 h-3 text-amber-400" />
                      <span>Ping Health</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: PROTOCOL SPECIFICATION */}
        {activeTab === 'docs' && (
          <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-6 space-y-4 text-xs">
            <h2 className="text-base font-bold text-white mb-2">Stage 3 & 4 Standardized Communication Contract</h2>
            <p className="text-neutral-400">
              The benchmark orchestrator dispatches identical requests to each competing agent concurrently using the standardized protocol contract:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <pre className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 font-mono text-neutral-300 overflow-x-auto">
{`// Dispatched Request (POST /execute)
{
  "protocolVersion": "1.0",
  "requestId": "req-run123-agentA",
  "task": {
    "taskId": "task-two-sum",
    "title": "Two Sum Problem",
    "description": "...",
    "language": "python",
    "input": { ... }
  },
  "constraints": {
    "timeoutSeconds": 60,
    "maxOutputSizeBytes": 100000
  }
}`}
              </pre>
              <pre className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 font-mono text-neutral-300 overflow-x-auto">
{`// Collected Response
{
  "protocolVersion": "1.0",
  "requestId": "req-run123-agentA",
  "status": "completed",
  "result": {
    "content": "def solution(...): ...",
    "files": { ... }
  },
  "metrics": {
    "durationMs": 450,
    "inputTokens": 120,
    "outputTokens": 85
  },
  "error": null
}`}
              </pre>
            </div>
          </div>
        )}
      </main>

      {/* LAUNCH BATTLE RUN WIZARD MODAL */}
      {isNewRunModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center space-x-2">
                <Flame className="w-5 h-5 text-amber-400 fill-current" />
                <h2 className="text-base font-bold text-white">Configure Benchmark Battle</h2>
              </div>
              <button onClick={() => setIsNewRunModalOpen(false)} className="text-neutral-500 hover:text-white">✕</button>
            </div>

            {runLaunchError && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-300">
                {runLaunchError}
              </div>
            )}

            {/* Step 1: Select Task */}
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                1. Select Benchmark Task *
              </label>
              <select
                value={selectedTaskId}
                onChange={e => setSelectedTaskId(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-amber-500"
              >
                {tasks.map(t => (
                  <option key={t.id} value={t.id}>
                    [{t.difficulty}] {t.title} ({t.language})
                  </option>
                ))}
              </select>

              {wizardTask && (
                <div className="mt-2 p-2.5 rounded-lg bg-neutral-950/60 border border-neutral-800 text-xs text-neutral-400">
                  <p className="line-clamp-2">{wizardTask.description}</p>
                </div>
              )}
            </div>

            {/* Step 2: Select >= 2 Agents */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-neutral-300">
                  2. Select Competing Agents (Minimum 2 Required) *
                </label>
                <span className="text-[11px] font-mono text-amber-400">
                  {selectedAgentIds.length} Selected
                </span>
              </div>

              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {agents.map(agent => {
                  const isChecked = selectedAgentIds.includes(agent.id);
                  return (
                    <div
                      key={agent.id}
                      onClick={() => {
                        setSelectedAgentIds(prev =>
                          isChecked ? prev.filter(id => id !== agent.id) : [...prev, agent.id]
                        );
                      }}
                      className={`p-3 rounded-lg border flex items-center justify-between cursor-pointer transition ${
                        isChecked
                          ? 'bg-amber-950/30 border-amber-700/80 text-white'
                          : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          readOnly
                          className="rounded border-neutral-700 text-amber-500 focus:ring-0"
                        />
                        <div>
                          <div className="text-xs font-medium text-neutral-200">{agent.name}</div>
                          <span className="text-[10px] text-neutral-500 font-mono">{agent.endpoint}</span>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          agent.connectionStatus === 'CONNECTED'
                            ? 'bg-emerald-950 text-emerald-400'
                            : 'bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {agent.connectionStatus}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Run Title Optional */}
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                3. Battle Title (Optional)
              </label>
              <input
                type="text"
                placeholder={wizardTask ? `Battle: ${wizardTask.title}` : 'Custom Arena Run Name'}
                value={runTitleInput}
                onChange={e => setRunTitleInput(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Launch Button */}
            <div className="pt-3 border-t border-neutral-800 flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setIsNewRunModalOpen(false)}
                className="px-4 py-2 text-xs text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLaunchingRun || selectedAgentIds.length < 2}
                onClick={handleLaunchRun}
                className="px-5 py-2 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-neutral-950 transition flex items-center space-x-1.5 disabled:opacity-50"
              >
                {isLaunchingRun && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Launch Benchmark Battle</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TASK CREATE / EDIT MODAL */}
      {isTaskModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative space-y-4">
            <h2 className="text-base font-bold text-white">
              {editingTask ? 'Edit Benchmark Task' : 'Create Benchmark Task'}
            </h2>

            <form onSubmit={handleSaveTask} className="space-y-3">
              {taskFormError && (
                <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-300">
                  {taskFormError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">Task Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Invert Binary Tree"
                  value={taskFormTitle}
                  onChange={e => setTaskFormTitle(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">Instructions & Description *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Problem description, requirements, constraints..."
                  value={taskFormDesc}
                  onChange={e => setTaskFormDesc(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">Language *</label>
                  <select
                    value={taskFormLang}
                    onChange={e => setTaskFormLang(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-2 text-xs text-neutral-200"
                  >
                    {COMMON_LANGUAGES.map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">Difficulty</label>
                  <select
                    value={taskFormDifficulty}
                    onChange={e => setTaskFormDifficulty(e.target.value as any)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-2 text-xs text-neutral-200"
                  >
                    <option value="EASY">Easy</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HARD">Hard</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">Timeout (s)</label>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={taskFormTimeout}
                    onChange={e => setTaskFormTimeout(Number(e.target.value))}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-2 text-xs text-neutral-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-300 mb-1">Input Data (JSON format)</label>
                <textarea
                  rows={2}
                  value={taskFormInputJson}
                  onChange={e => setTaskFormInputJson(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-neutral-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="pt-3 border-t border-neutral-800 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsTaskModalOpen(false)}
                  className="px-4 py-2 text-xs text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingTask}
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center space-x-1"
                >
                  {isSavingTask && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingTask ? 'Update Task' : 'Create Task'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DIAGNOSTIC MODAL */}
      {testingAgent && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>Health Diagnostic: {testingAgent.name}</span>
            </h3>

            {isTestingInProgress ? (
              <div className="py-8 text-center text-xs text-neutral-400">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-400 mb-2" />
                <span>Pinging GET /health...</span>
              </div>
            ) : testResult ? (
              <div className="space-y-2 text-xs font-mono">
                <div
                  className={`p-3 rounded-lg border ${
                    testResult.success
                      ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                      : 'bg-rose-950/60 border-rose-800 text-rose-300'
                  }`}
                >
                  {testResult.success ? `✓ Online (${testResult.latencyMs}ms)` : `✗ Failed: ${testResult.errorMessage}`}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setTestingAgent(null)}
                className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STAGE 5: EVALUATION BREAKDOWN & TEST CASES MODAL */}
      {selectedEvalDetail && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  <span>Evaluation Diagnostic: {selectedEvalDetail.agentName}</span>
                </h3>
                <span className="text-[11px] text-neutral-500 font-mono">
                  Engine Version {selectedEvalDetail.evaluationVersion} • Evaluated {new Date(selectedEvalDetail.evaluatedAt).toLocaleTimeString()}
                </span>
              </div>
              <button onClick={() => setSelectedEvalDetail(null)} className="text-neutral-500 hover:text-white">✕</button>
            </div>

            {/* Overall Score Banner */}
            <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-neutral-400 block">Normalized Overall Score</span>
                <span className="text-2xl font-black text-cyan-400 font-mono">
                  {selectedEvalDetail.overallScore}<span className="text-xs text-neutral-500 font-normal"> / 100</span>
                </span>
              </div>
              <div className="text-right text-xs font-mono">
                <span className="text-neutral-400 block">Validation Tests</span>
                <span className="text-emerald-400 font-bold">
                  {selectedEvalDetail.passedTestCount} Passed / {selectedEvalDetail.totalTestCount} Total
                </span>
              </div>
            </div>

            {/* Test Cases Results List */}
            <div>
              <span className="text-xs font-semibold text-neutral-300 block mb-2">Deterministic Test Case Results:</span>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {selectedEvalDetail.breakdown.testCaseResults.map((tc, i) => (
                  <div
                    key={i}
                    className={`p-2.5 rounded-lg border text-xs ${
                      tc.passed
                        ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                        : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold mb-0.5">
                      <div className="flex items-center space-x-1.5">
                        {tc.passed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        <span>{tc.name}</span>
                      </div>
                      <span className="text-[10px] uppercase font-mono">{tc.passed ? 'PASS' : 'FAIL'}</span>
                    </div>
                    <p className="text-[11px] opacity-90 pl-5">{tc.message}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Metric Explanations */}
            <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 text-[11px] font-mono text-neutral-400 space-y-1">
              <div>• {selectedEvalDetail.breakdown.accuracyDetails}</div>
              <div>• {selectedEvalDetail.breakdown.completionDetails}</div>
              <div>• {selectedEvalDetail.breakdown.reliabilityDetails}</div>
              <div>• {selectedEvalDetail.breakdown.speedDetails}</div>
              <div>• {selectedEvalDetail.breakdown.costDetails}</div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setSelectedEvalDetail(null)}
                className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-white"
              >
                Close Diagnostic
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
