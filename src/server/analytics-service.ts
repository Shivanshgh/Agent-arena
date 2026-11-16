import { agentDb } from './db';
import { benchmarkDb } from './benchmark-db';
import { evaluationDb } from './evaluation-db';
import { LeaderboardEntry, AnalyticsOverview, BenchmarkReport } from '../types/analytics';
import { Agent } from '../types/agent';
import { BenchmarkRun, BenchmarkTask } from '../types/benchmark';
import { ExecutionEvaluation } from '../types/evaluation';

export interface AnalyticsSnapshot {
  agents: Agent[];
  runs: BenchmarkRun[];
  tasks: BenchmarkTask[];
  evaluations: ExecutionEvaluation[];
}

export const analyticsService = {
  /**
   * Calculates leaderboard entries across all evaluated agent benchmark runs
   */
  getLeaderboard(filters: { language?: string; category?: string } = {}, snapshot?: AnalyticsSnapshot): LeaderboardEntry[] {
    const agents = snapshot?.agents || agentDb.list();
    const runs = snapshot?.runs || benchmarkDb.listRuns();
    const tasks = snapshot?.tasks || benchmarkDb.listTasks();

    // Map tasks by ID for quick lookup
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    // Aggregate stats per agent
    const agentStats = new Map<
      string,
      {
        agentId: string;
        agentName: string;
        version: string;
        supportedLanguages: string[];
        overallScores: number[];
        accuracyScores: number[];
        completionScores: number[];
        reliabilityScores: number[];
        speedScores: number[];
        costScores: number[];
        totalExecutions: number;
        completedExecutions: number;
      }
    >();

    for (const agent of agents) {
      agentStats.set(agent.id, {
        agentId: agent.id,
        agentName: agent.name,
        version: agent.version,
        supportedLanguages: agent.supportedLanguages,
        overallScores: [],
        accuracyScores: [],
        completionScores: [],
        reliabilityScores: [],
        speedScores: [],
        costScores: [],
        totalExecutions: 0,
        completedExecutions: 0,
      });
    }

    // Process runs & evaluations
    for (const run of runs) {
      const task = taskMap.get(run.taskId);

      // Apply task language and category filters if provided
      if (filters.language && task && task.language.toLowerCase() !== filters.language.toLowerCase()) {
        continue;
      }
      if (filters.category && task && task.category.toLowerCase() !== filters.category.toLowerCase()) {
        continue;
      }

      const runEvals = snapshot ? snapshot.evaluations.filter((e) => e.runId === run.id) : evaluationDb.listForRun(run.id);
      const evalMap = new Map(runEvals.map(e => [e.executionId, e]));

      for (const exec of run.executions) {
        let stats = agentStats.get(exec.agentId);
        if (!stats) {
          // If agent was registered previously and recorded in execution
          stats = {
            agentId: exec.agentId,
            agentName: exec.agentName,
            version: '1.0.0',
            supportedLanguages: [],
            overallScores: [],
            accuracyScores: [],
            completionScores: [],
            reliabilityScores: [],
            speedScores: [],
            costScores: [],
            totalExecutions: 0,
            completedExecutions: 0,
          };
          agentStats.set(exec.agentId, stats);
        }

        stats.totalExecutions++;
        if (exec.status === 'COMPLETED') {
          stats.completedExecutions++;
        }

        const ev = evalMap.get(exec.id);
        if (ev) {
          stats.overallScores.push(ev.overallScore);
          stats.accuracyScores.push(ev.accuracyScore);
          stats.completionScores.push(ev.completionScore);
          stats.reliabilityScores.push(ev.reliabilityScore);
          stats.speedScores.push(ev.speedScore);
          if (ev.costEfficiencyScore !== null) {
            stats.costScores.push(ev.costEfficiencyScore);
          }
        }
      }
    }

    // Compute averages and compile leaderboard entries
    const entries: LeaderboardEntry[] = [];

    for (const stats of Array.from(agentStats.values())) {
      const evalCount = stats.overallScores.length;
      if (evalCount === 0) continue; // Exclude agents with no evaluated executions

      const avg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

      const overall = avg(stats.overallScores);
      const accuracy = avg(stats.accuracyScores);
      const completion = avg(stats.completionScores);
      const reliability = avg(stats.reliabilityScores);
      const speed = avg(stats.speedScores);
      const cost = stats.costScores.length > 0 ? avg(stats.costScores) : null;
      const successRate = stats.totalExecutions > 0
        ? Math.round((stats.completedExecutions / stats.totalExecutions) * 100)
        : 0;

      entries.push({
        rank: 0,
        agentId: stats.agentId,
        agentName: stats.agentName,
        version: stats.version,
        overallScore: overall,
        accuracyScore: accuracy,
        completionScore: completion,
        reliabilityScore: reliability,
        speedScore: speed,
        costEfficiencyScore: cost,
        totalEvaluatedRuns: evalCount,
        totalExecutions: stats.totalExecutions,
        successRate,
        supportedLanguages: stats.supportedLanguages,
      });
    }

    // Deterministic sorting with tie-breaking rules:
    // 1. Overall Score desc
    // 2. Accuracy Score desc
    // 3. Speed Score desc
    // 4. Alphabetical agentName
    entries.sort((a, b) => {
      if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
      if (b.accuracyScore !== a.accuracyScore) return b.accuracyScore - a.accuracyScore;
      if (b.speedScore !== a.speedScore) return b.speedScore - a.speedScore;
      return a.agentName.localeCompare(b.agentName);
    });

    // Assign rank
    return entries.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
  },

  /**
   * Generates system-wide analytics overview
   */
  getAnalytics(snapshot?: AnalyticsSnapshot): AnalyticsOverview {
    const runs = snapshot?.runs || benchmarkDb.listRuns();
    const tasks = snapshot?.tasks || benchmarkDb.listTasks();
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    let totalExecutions = 0;
    let completedExecutions = 0;
    let totalDurationMs = 0;
    let measuredDurationCount = 0;

    const categoryStats: Record<string, { count: number; totalScore: number }> = {};
    const languageStats: Record<string, { count: number; totalScore: number }> = {};
    const recentEvals: AnalyticsOverview['recentEvaluations'] = [];
    let totalScoreSum = 0;
    let totalEvalCount = 0;

    for (const run of runs) {
      const task = taskMap.get(run.taskId);
      const category = task?.category || 'Algorithms';
      const language = task?.language || 'python';

      if (!categoryStats[category]) categoryStats[category] = { count: 0, totalScore: 0 };
      if (!languageStats[language]) languageStats[language] = { count: 0, totalScore: 0 };

      const runEvals = snapshot ? snapshot.evaluations.filter((e) => e.runId === run.id) : evaluationDb.listForRun(run.id);
      const evalMap = new Map(runEvals.map(e => [e.executionId, e]));

      for (const exec of run.executions) {
        totalExecutions++;
        if (exec.status === 'COMPLETED') completedExecutions++;
        if (exec.durationMs) {
          totalDurationMs += exec.durationMs;
          measuredDurationCount++;
        }

        const ev = evalMap.get(exec.id);
        if (ev) {
          totalScoreSum += ev.overallScore;
          totalEvalCount++;

          categoryStats[category].count++;
          categoryStats[category].totalScore += ev.overallScore;

          languageStats[language].count++;
          languageStats[language].totalScore += ev.overallScore;

          if (recentEvals.length < 10) {
            recentEvals.push({
              runId: run.id,
              taskTitle: run.taskTitle,
              agentName: exec.agentName,
              overallScore: ev.overallScore,
              evaluatedAt: ev.evaluatedAt,
            });
          }
        }
      }
    }

    const categoryBreakdown: Record<string, { count: number; avgScore: number }> = {};
    for (const [cat, s] of Object.entries(categoryStats)) {
      categoryBreakdown[cat] = {
        count: s.count,
        avgScore: s.count > 0 ? Math.round(s.totalScore / s.count) : 0,
      };
    }

    const languageBreakdown: Record<string, { count: number; avgScore: number }> = {};
    for (const [lang, s] of Object.entries(languageStats)) {
      languageBreakdown[lang] = {
        count: s.count,
        avgScore: s.count > 0 ? Math.round(s.totalScore / s.count) : 0,
      };
    }

    return {
      totalBenchmarkRuns: runs.length,
      totalExecutions,
      totalEvaluatedExecutions: totalEvalCount,
      overallSuccessRate: totalExecutions > 0 ? Math.round((completedExecutions / totalExecutions) * 100) : 0,
      averageDurationMs: measuredDurationCount > 0 ? Math.round(totalDurationMs / measuredDurationCount) : 0,
      averageOverallScore: totalEvalCount > 0 ? Math.round(totalScoreSum / totalEvalCount) : 0,
      categoryBreakdown,
      languageBreakdown,
      recentEvaluations: recentEvals,
    };
  },

  /**
   * Compiles structured report for a benchmark run
   */
  generateRunReport(runId: string, snapshot?: AnalyticsSnapshot): BenchmarkReport | null {
    const run = snapshot?.runs.find((r) => r.id === runId) || (snapshot ? null : benchmarkDb.getRun(runId));
    if (!run) return null;

    const task = snapshot?.tasks.find((t) => t.id === run.taskId) || (snapshot ? null : benchmarkDb.getTask(run.taskId));
    const evals = snapshot ? snapshot.evaluations.filter((e) => e.runId === run.id) : evaluationDb.listForRun(run.id);
    const evalMap = new Map(evals.map(e => [e.executionId, e]));

    const agentResults = run.executions.map(exec => {
      const ev = evalMap.get(exec.id);
      return {
        agentId: exec.agentId,
        agentName: exec.agentName,
        status: exec.status,
        durationMs: exec.durationMs,
        overallScore: ev ? ev.overallScore : null,
        accuracyScore: ev ? ev.accuracyScore : null,
        completionScore: ev ? ev.completionScore : null,
        reliabilityScore: ev ? ev.reliabilityScore : null,
        speedScore: ev ? ev.speedScore : null,
        costEfficiencyScore: ev ? ev.costEfficiencyScore : null,
        passedTestCount: ev ? ev.passedTestCount : null,
        totalTestCount: ev ? ev.totalTestCount : null,
        errorMessage: exec.errorMessage,
      };
    });

    return {
      runId: run.id,
      title: run.title,
      taskTitle: run.taskTitle,
      taskLanguage: run.taskLanguage,
      taskCategory: task?.category || 'Algorithms',
      taskDifficulty: run.taskDifficulty,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      status: run.status,
      agentResults,
    };
  },

  /**
   * Exports report as CSV string
   */
  exportReportCsv(report: BenchmarkReport): string {
    const headers = [
      'Run ID',
      'Title',
      'Task Title',
      'Language',
      'Difficulty',
      'Status',
      'Agent Name',
      'Execution Status',
      'Duration (ms)',
      'Overall Score',
      'Accuracy (%)',
      'Completion (%)',
      'Reliability (%)',
      'Speed (%)',
      'Cost Efficiency (%)',
      'Tests Passed',
      'Error Message',
    ];

    const rows: string[] = [headers.join(',')];

    for (const ag of report.agentResults) {
      const row = [
        `"${report.runId}"`,
        `"${report.title.replace(/"/g, '""')}"`,
        `"${report.taskTitle.replace(/"/g, '""')}"`,
        `"${report.taskLanguage}"`,
        `"${report.taskDifficulty}"`,
        `"${report.status}"`,
        `"${ag.agentName.replace(/"/g, '""')}"`,
        `"${ag.status}"`,
        ag.durationMs !== null ? ag.durationMs : '',
        ag.overallScore !== null ? ag.overallScore : '',
        ag.accuracyScore !== null ? ag.accuracyScore : '',
        ag.completionScore !== null ? ag.completionScore : '',
        ag.reliabilityScore !== null ? ag.reliabilityScore : '',
        ag.speedScore !== null ? ag.speedScore : '',
        ag.costEfficiencyScore !== null ? ag.costEfficiencyScore : '',
        ag.passedTestCount !== null ? `${ag.passedTestCount}/${ag.totalTestCount}` : '',
        `"${(ag.errorMessage || '').replace(/"/g, '""')}"`,
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  },
};
