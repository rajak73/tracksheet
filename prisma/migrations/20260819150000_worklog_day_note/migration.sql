-- The instructor's own note about a day — "all planned sessions completed".
-- Distinct from the per-activity remarks, which describe single entries and are
-- read out of the sentences; this is a judgement about the whole day that only
-- the person who lived it can make.
CREATE TABLE "WorklogDayNote" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorklogDayNote_pkey" PRIMARY KEY ("id")
);

-- One note per instructor per day: writing it again corrects it rather than
-- adding a second opinion.
CREATE UNIQUE INDEX "WorklogDayNote_instructorId_workDate_key"
    ON "WorklogDayNote"("instructorId", "workDate");
CREATE INDEX "WorklogDayNote_universityId_workDate_idx"
    ON "WorklogDayNote"("universityId", "workDate");

ALTER TABLE "WorklogDayNote" ADD CONSTRAINT "WorklogDayNote_instructorId_fkey"
    FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
