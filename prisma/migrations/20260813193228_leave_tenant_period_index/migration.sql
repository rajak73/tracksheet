-- CreateIndex
CREATE INDEX "LeaveRequest_universityId_status_startDate_endDate_idx" ON "LeaveRequest"("universityId", "status", "startDate", "endDate");
