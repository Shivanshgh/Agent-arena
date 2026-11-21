CREATE TYPE "ModelProvider" AS ENUM ('GEMINI', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK');
CREATE TYPE "EvaluationStrategy" AS ENUM ('CODE_UNVERIFIED', 'EXACT_MATCH', 'JSON_EXACT', 'HEURISTIC_TEXT');
ALTER TABLE "BenchmarkTask" ADD COLUMN "evaluationStrategy" "EvaluationStrategy" NOT NULL DEFAULT 'CODE_UNVERIFIED';
ALTER TABLE "ExecutionEvaluation" ALTER COLUMN "accuracyScore" DROP NOT NULL;
ALTER TABLE "ExecutionEvaluation" ALTER COLUMN "overallScore" DROP NOT NULL;

CREATE TABLE "ProviderCredential" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "provider" "ModelProvider" NOT NULL,
  "encryptedApiKey" TEXT NOT NULL,
  "apiKeyIv" TEXT NOT NULL,
  "apiKeyTag" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelConnection" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "provider" "ModelProvider" NOT NULL,
  "modelId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelExecution" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "connectionId" TEXT,
  "provider" "ModelProvider" NOT NULL,
  "modelId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "errorMessage" TEXT,
  "rawOutput" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "ModelExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelEvaluation" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "modelExecutionId" TEXT NOT NULL,
  "accuracyScore" DOUBLE PRECISION,
  "completionScore" DOUBLE PRECISION NOT NULL,
  "reliabilityScore" DOUBLE PRECISION NOT NULL,
  "speedScore" DOUBLE PRECISION NOT NULL,
  "costEfficiencyScore" DOUBLE PRECISION,
  "overallScore" DOUBLE PRECISION,
  "evaluationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "evaluationVersion" TEXT NOT NULL DEFAULT '1.1.0',
  "breakdown" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCredential_ownerId_provider_key" ON "ProviderCredential"("ownerId", "provider");
CREATE INDEX "ProviderCredential_ownerId_idx" ON "ProviderCredential"("ownerId");
CREATE UNIQUE INDEX "ModelConnection_ownerId_provider_modelId_key" ON "ModelConnection"("ownerId", "provider", "modelId");
CREATE INDEX "ModelConnection_ownerId_provider_idx" ON "ModelConnection"("ownerId", "provider");
CREATE UNIQUE INDEX "ModelExecution_requestId_key" ON "ModelExecution"("requestId");
CREATE INDEX "ModelExecution_runId_status_idx" ON "ModelExecution"("runId", "status");
CREATE INDEX "ModelExecution_connectionId_idx" ON "ModelExecution"("connectionId");
CREATE INDEX "ModelExecution_provider_modelId_idx" ON "ModelExecution"("provider", "modelId");
CREATE UNIQUE INDEX "ModelEvaluation_modelExecutionId_key" ON "ModelEvaluation"("modelExecutionId");
CREATE INDEX "ModelEvaluation_runId_idx" ON "ModelEvaluation"("runId");

ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelConnection" ADD CONSTRAINT "ModelConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelConnection" ADD CONSTRAINT "ModelConnection_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ProviderCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelExecution" ADD CONSTRAINT "ModelExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelExecution" ADD CONSTRAINT "ModelExecution_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ModelConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModelEvaluation" ADD CONSTRAINT "ModelEvaluation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelEvaluation" ADD CONSTRAINT "ModelEvaluation_modelExecutionId_fkey" FOREIGN KEY ("modelExecutionId") REFERENCES "ModelExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
