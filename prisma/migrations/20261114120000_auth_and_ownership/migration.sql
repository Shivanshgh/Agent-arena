CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Agent" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "BenchmarkTask" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "BenchmarkTask" ADD COLUMN "isShared" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BenchmarkTask" ALTER COLUMN "isShared" SET DEFAULT false;
ALTER TABLE "BenchmarkRun" ADD COLUMN "ownerId" TEXT;

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
CREATE INDEX "Agent_ownerId_idx" ON "Agent"("ownerId");
CREATE INDEX "BenchmarkTask_ownerId_isShared_idx" ON "BenchmarkTask"("ownerId", "isShared");
CREATE INDEX "BenchmarkRun_ownerId_startedAt_idx" ON "BenchmarkRun"("ownerId", "startedAt");

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BenchmarkTask" ADD CONSTRAINT "BenchmarkTask_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
