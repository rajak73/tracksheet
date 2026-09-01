-- One cached AI insight per (instructor, scope, period).
--
-- Additive: nothing existing is read, written or dropped. The table is empty
-- after this runs and fills lazily, one row the first time somebody opens a
-- period, so there is nothing to backfill and no behaviour changes until the
-- read path starts using it.
--
-- `contextHash` is what makes the cache correct: SHA-256 over the canonical
-- context, the prompt version and the model id. A data edit, a prompt edit and
-- a model switch therefore all invalidate through one comparison. There is no
-- TTL column on purpose — an insight that still matches its data is still
-- right however old it is.
--
-- Reversing this drops the table and both enums; see down.sql beside it. No
-- worklog data is involved either way.

-- CreateEnum
CREATE TYPE "InsightScopeType" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "InsightCacheStatus" AS ENUM ('READY', 'GENERATING', 'FAILED');

-- CreateTable
CREATE TABLE "AiInsightCache" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "scopeType" "InsightScopeType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "contextHash" CHAR(64) NOT NULL,
    "contextSnapshot" JSONB NOT NULL,
    "insightPayload" JSONB NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" "InsightCacheStatus" NOT NULL DEFAULT 'READY',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastServedAt" TIMESTAMP(3),
    "serveCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiInsightCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiInsightCache_contextHash_idx" ON "AiInsightCache"("contextHash");

-- CreateIndex
CREATE UNIQUE INDEX "AiInsightCache_instructorId_scopeType_periodStart_periodEnd_key" ON "AiInsightCache"("instructorId", "scopeType", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "AiInsightCache" ADD CONSTRAINT "AiInsightCache_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
