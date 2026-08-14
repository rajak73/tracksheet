-- DropIndex
DROP INDEX "Instructor_universityId_idx";

-- CreateIndex
CREATE INDEX "ActivityLog_instructorId_startTime_idx" ON "ActivityLog"("instructorId", "startTime");

-- CreateIndex
CREATE INDEX "Instructor_universityId_createdAt_idx" ON "Instructor"("universityId", "createdAt");

-- CreateIndex
CREATE INDEX "Instructor_createdAt_idx" ON "Instructor"("createdAt");
