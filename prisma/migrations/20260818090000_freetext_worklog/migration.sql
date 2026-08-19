-- CreateEnum
CREATE TYPE "WorklogParseStatus" AS ENUM ('PENDING', 'PARSED', 'FAILED');

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "deliverableTypeId" TEXT,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "rawText" TEXT,
ADD COLUMN     "submissionId" TEXT;

-- CreateTable
CREATE TABLE "DeliverableType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "activityTypeId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverableType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorklogSubmission" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "rawBullets" JSONB NOT NULL,
    "status" "WorklogParseStatus" NOT NULL DEFAULT 'PENDING',
    "parseError" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parsedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorklogSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliverableType_code_key" ON "DeliverableType"("code");

-- CreateIndex
CREATE INDEX "DeliverableType_activityTypeId_sortOrder_idx" ON "DeliverableType"("activityTypeId", "sortOrder");

-- CreateIndex
CREATE INDEX "WorklogSubmission_escalatedAt_reviewedAt_submittedAt_idx" ON "WorklogSubmission"("escalatedAt", "reviewedAt", "submittedAt");

-- CreateIndex
CREATE INDEX "WorklogSubmission_instructorId_workDate_idx" ON "WorklogSubmission"("instructorId", "workDate");

-- CreateIndex
CREATE INDEX "WorklogSubmission_status_submittedAt_idx" ON "WorklogSubmission"("status", "submittedAt");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WorklogSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_deliverableTypeId_fkey" FOREIGN KEY ("deliverableTypeId") REFERENCES "DeliverableType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableType" ADD CONSTRAINT "DeliverableType_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorklogSubmission" ADD CONSTRAINT "WorklogSubmission_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorklogSubmission" ADD CONSTRAINT "WorklogSubmission_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

