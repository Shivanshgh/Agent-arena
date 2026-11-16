# AgentArena demo walkthrough (under 4 minutes)

**Recording status: NOT READY.** Record only after the live PostgreSQL-backed workflow is verified. Use a clean demo account, non-sensitive agent endpoints, and real run results; do not seed fake results or show credentials.

| Time | Show and say |
| --- | --- |
| 0:00–0:20 | Introduce AgentArena as a benchmark and comparison tool for coding agents. |
| 0:20–0:45 | Sign in; show the dashboard’s actual agent, task, run, and result data. |
| 0:45–1:15 | Register a demo agent, configure its endpoint and auth without revealing its secret, then run a connection test. |
| 1:15–1:40 | Open a benchmark task and briefly show its language, instructions, test cases, and time limit. |
| 1:40–2:25 | Select the task and multiple agents, launch a run, and show live progress and any failures/timeouts. |
| 2:25–3:05 | Open the completed run, show its execution outputs and deterministic evaluation scores, then compare agents on the leaderboard. |
| 3:05–3:30 | Open run history and show timestamps and past results; sign out. |

Before recording, confirm the same account’s records remain after restarting the API and worker. If live agents, Redis, Docker, or Bifrost are not available, omit those claims and label the missing integration; never simulate it as real.
