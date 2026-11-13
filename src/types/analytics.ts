export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  version: string;
  overallScore: number;
  accuracyScore: number;
  completionScore: number;
  reliabilityScore: number;
  speedScore: number;
  costEfficiencyScore: number | null;
  totalEvaluatedRuns: number;
  totalExecutions: number;
  successRate: number; // 0 - 100%
  supportedLanguages: string[];
}

export interface AnalyticsOverview {
  totalBenchmarkRuns: number;
  totalExecutions: number;
  totalEvaluatedExecutions: number;
  overallSuccessRate: number; // percentage
  averageDurationMs: number;
  averageOverallScore: number;
  categoryBreakdown: Record<string, { count: number; avgScore: number }>;
  languageBreakdown: Record<string, { count: number; avgScore: number }>;
  recentEvaluations: Array<{
    runId: string;
    taskTitle: string;
    agentName: string;
    overallScore: number;
    evaluatedAt: string;
  }>;
}

export interface BenchmarkReport {
  runId: string;
  title: string;
  taskTitle: string;
  taskLanguage: string;
  taskCategory: string;
  taskDifficulty: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: string;
  agentResults: Array<{
    agentId: string;
    agentName: string;
    status: string;
    durationMs: number | null;
    overallScore: number | null;
    accuracyScore: number | null;
    completionScore: number | null;
    reliabilityScore: number | null;
    speedScore: number | null;
    costEfficiencyScore: number | null;
    passedTestCount: number | null;
    totalTestCount: number | null;
    errorMessage: string | null;
  }>;
}

export interface InfrastructureStatus {
  timestamp: string;
  docker: {
    status: 'AVAILABLE' | 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE' | 'DISABLED';
    isolationReady: boolean;
    reason: string;
    securitySettings: {
      networkDisabled: boolean;
      nonRootUser: boolean;
      memoryLimit: string;
      cpuLimit: string;
      readOnlyRoot: boolean;
    };
  };
  redis: {
    status: 'CONNECTED' | 'DISCONNECTED' | 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE';
    host: string;
    port: number;
    latencyMs: number | null;
    error: string | null;
  };
  bullmq: {
    status: 'ACTIVE' | 'OFFLINE';
    queueName: string;
    concurrency: number;
    activeJobs: number;
    waitingJobs: number;
    completedJobs: number;
    failedJobs: number;
  };
  bifrost: {
    status: 'CONFIGURED' | 'NOT_CONFIGURED';
    endpoint: string | null;
    supportedProviders: string[];
    hasApiKey: boolean;
  };
}
