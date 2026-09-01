-- Down migration for 20260901090000_worklog_entry_source.
--
-- Drops a provenance marker. No day's text, date, quantity or hours is involved,
-- and the marker is recomputable from "ActivityLog" for as long as that table
-- exists.

ALTER TABLE "WorklogEntry" DROP COLUMN "source";
DROP TYPE IF EXISTS "WorklogEntrySource";
