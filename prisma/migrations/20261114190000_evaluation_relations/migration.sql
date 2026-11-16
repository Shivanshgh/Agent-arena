CREATE INDEX "ExecutionEvaluation_taskId_idx" ON "ExecutionEvaluation"("taskId");

ALTER TABLE "ExecutionEvaluation"
  ADD CONSTRAINT "ExecutionEvaluation_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "BenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExecutionEvaluation"
  ADD CONSTRAINT "ExecutionEvaluation_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "BenchmarkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
