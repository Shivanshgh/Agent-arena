-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('HTTP', 'DOCKER', 'SDK');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'UNREACHABLE', 'ERROR', 'UNTESTED');

-- CreateEnum
CREATE TYPE "AuthType" AS ENUM ('NONE', 'BEARER', 'API_KEY', 'CUSTOM_HEADER');

-- CreateEnum
CREATE TYPE "TaskDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMED_OUT');

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "integrationType" "IntegrationType" NOT NULL DEFAULT 'HTTP',
    "endpoint" TEXT NOT NULL,
    "supportedLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supportedCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authType" "AuthType" NOT NULL DEFAULT 'NONE',
    "authHeaderName" TEXT,
    "encryptedAuthSecret" TEXT,
    "authSecretIv" TEXT,
    "authSecretTag" TEXT,
    "connectionStatus" "ConnectionStatus" NOT NULL DEFAULT 'UNTESTED',
    "lastSuccessfulConnection" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Algorithms',
    "difficulty" "TaskDifficulty" NOT NULL DEFAULT 'MEDIUM',
    "inputData" JSONB NOT NULL DEFAULT '{}',
    "expectedOutput" TEXT,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 60,
    "maxOutputSizeBytes" INTEGER NOT NULL DEFAULT 100000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchmarkTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkRun" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "BenchmarkRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentExecution" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "errorMessage" TEXT,
    "rawOutput" TEXT,
    "files" JSONB,
    "metadata" JSONB DEFAULT '{}',

    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionEvaluation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "accuracyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "speedScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costEfficiencyScore" DOUBLE PRECISION,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passedTestCount" INTEGER NOT NULL DEFAULT 0,
    "failedTestCount" INTEGER NOT NULL DEFAULT 0,
    "totalTestCount" INTEGER NOT NULL DEFAULT 0,
    "evaluationStatus" TEXT NOT NULL DEFAULT 'EVALUATED',
    "evaluationVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "breakdown" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionLog" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "testedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "latencyMs" DOUBLE PRECISION,
    "resolvedIp" TEXT,
    "errorMessage" TEXT,
    "responseBody" JSONB,

    CONSTRAINT "ConnectionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL DEFAULT '1.0',
    "taskTitle" TEXT NOT NULL,
    "taskLanguage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,
    "responseContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agent_connectionStatus_idx" ON "Agent"("connectionStatus");

-- CreateIndex
CREATE INDEX "Agent_name_idx" ON "Agent"("name");

-- CreateIndex
CREATE INDEX "BenchmarkTask_language_idx" ON "BenchmarkTask"("language");

-- CreateIndex
CREATE INDEX "BenchmarkTask_difficulty_idx" ON "BenchmarkTask"("difficulty");

-- CreateIndex
CREATE INDEX "BenchmarkRun_taskId_status_idx" ON "BenchmarkRun"("taskId", "status");

-- CreateIndex
CREATE INDEX "AgentExecution_runId_status_idx" ON "AgentExecution"("runId", "status");

-- CreateIndex
CREATE INDEX "AgentExecution_agentId_idx" ON "AgentExecution"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecution_runId_agentId_key" ON "AgentExecution"("runId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecution_requestId_key" ON "AgentExecution"("requestId");

-- CreateIndex
CREATE INDEX "ExecutionEvaluation_runId_idx" ON "ExecutionEvaluation"("runId");

-- CreateIndex
CREATE INDEX "ExecutionEvaluation_executionId_idx" ON "ExecutionEvaluation"("executionId");

-- CreateIndex
CREATE INDEX "ExecutionEvaluation_agentId_idx" ON "ExecutionEvaluation"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionEvaluation_executionId_key" ON "ExecutionEvaluation"("executionId");

-- CreateIndex
CREATE INDEX "ConnectionLog_agentId_testedAt_idx" ON "ConnectionLog"("agentId", "testedAt");

-- CreateIndex
CREATE INDEX "AgentTask_agentId_createdAt_idx" ON "AgentTask"("agentId", "createdAt");

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BenchmarkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionEvaluation" ADD CONSTRAINT "ExecutionEvaluation_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AgentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionEvaluation" ADD CONSTRAINT "ExecutionEvaluation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionLog" ADD CONSTRAINT "ConnectionLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

