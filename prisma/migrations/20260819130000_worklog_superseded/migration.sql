-- Editing a day replaces it. The earlier submission is marked rather than
-- deleted: its activities go (they describe text that no longer stands) but the
-- instructor's own words stay on the record.
ALTER TABLE "WorklogSubmission" ADD COLUMN "supersededAt" TIMESTAMP(3);

CREATE INDEX "WorklogSubmission_instructorId_workDate_supersededAt_idx"
    ON "WorklogSubmission"("instructorId", "workDate", "supersededAt");
