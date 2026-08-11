-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('COMPLETED', 'MISSED', 'LATE', 'EXCUSED');

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "activityTypeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'COMPLETED',
    "remarks" TEXT,
    "isOncePerDay" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_instructorId_workDate_idx" ON "ActivityLog"("instructorId", "workDate");

-- CreateIndex
CREATE INDEX "ActivityLog_universityId_idx" ON "ActivityLog"("universityId");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add Partial Unique Index for isOncePerDay
CREATE UNIQUE INDEX "ActivityLog_once_per_day_idx" ON "ActivityLog"("instructorId", "workDate", "activityTypeId") WHERE "isOncePerDay" = true;
