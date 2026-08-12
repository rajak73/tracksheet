-- CreateEnum
CREATE TYPE "MetricsJobTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'SEED');

-- CreateEnum
CREATE TYPE "MetricsJobStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "MetricsJobRun" (
    "id" TEXT NOT NULL,
    "trigger" "MetricsJobTrigger" NOT NULL,
    "status" "MetricsJobStatus" NOT NULL DEFAULT 'RUNNING',
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "universitiesProcessed" INTEGER NOT NULL DEFAULT 0,
    "instructorDaysWritten" INTEGER NOT NULL DEFAULT 0,
    "instructorWeeksWritten" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "MetricsJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetricsJobRun_status_startedAt_idx" ON "MetricsJobRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "MetricsJobRun_startedAt_idx" ON "MetricsJobRun"("startedAt");
