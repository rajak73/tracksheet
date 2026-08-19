-- CreateEnum
CREATE TYPE "WorklogApproval" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WorklogExceptionReason" AS ENUM ('SUBMITTED_OFF_HOURS', 'ACTIVITY_OFF_HOURS', 'BOTH');

-- AlterTable
ALTER TABLE "WorklogSubmission" ADD COLUMN     "approval" "WorklogApproval" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "exceptionReason" "WorklogExceptionReason";

-- CreateIndex
CREATE INDEX "WorklogSubmission_approval_universityId_submittedAt_idx" ON "WorklogSubmission"("approval", "universityId", "submittedAt");

-- AddForeignKey
ALTER TABLE "WorklogSubmission" ADD CONSTRAINT "WorklogSubmission_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

