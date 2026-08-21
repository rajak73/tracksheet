-- One day's worklog, normalised for reading.
--
-- A cache, never a source: the instructor's own words stay in ActivityLog.
-- Holds no figures from the model — `groups` records which source rows each
-- named group covers, and every duration and quantity is summed from those rows
-- at read time.
--
-- `sourceFingerprint` is taken over the activities it was built from, so
-- correcting one of them makes this row stale and it is rebuilt rather than
-- shown against data it no longer describes.
CREATE TABLE "WorklogDaySummary" (
  "id"                TEXT         NOT NULL,
  "instructorId"      TEXT         NOT NULL,
  "universityId"      TEXT         NOT NULL,
  "workDate"          DATE         NOT NULL,
  "sourceFingerprint" TEXT         NOT NULL,
  "groups"            JSONB        NOT NULL,
  "remarks"           JSONB        NOT NULL,
  "totalMinutes"      INTEGER      NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorklogDaySummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorklogDaySummary_instructorId_workDate_key"
  ON "WorklogDaySummary"("instructorId", "workDate");

CREATE INDEX "WorklogDaySummary_universityId_workDate_idx"
  ON "WorklogDaySummary"("universityId", "workDate");

ALTER TABLE "WorklogDaySummary"
  ADD CONSTRAINT "WorklogDaySummary_instructorId_fkey"
  FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorklogDaySummary"
  ADD CONSTRAINT "WorklogDaySummary_universityId_fkey"
  FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;
