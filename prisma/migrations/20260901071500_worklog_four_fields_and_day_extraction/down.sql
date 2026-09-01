-- Down migration for 20260901071500_worklog_four_fields_and_day_extraction.
--
-- Apply by hand when reverting, then delete this migration's row from
-- "_prisma_migrations":
--   psql "$DATABASE_URL" -f prisma/migrations/20260901071500_worklog_four_fields_and_day_extraction/down.sql
--
-- Reversing the SHAPE is possible; reversing the SPLIT is not. The four fields
-- hold the whole day's text joined with ", ", and once joined there is no
-- reliable way to know where one activity ended and the next began — a
-- description may contain a comma of its own. So this rebuilds a single-item
-- array rather than pretending to recover the original items.
--
-- `ActivityLog` still holds the true per-activity rows if a faithful restore is
-- needed. Take it from there, not from here.

ALTER TABLE "WorklogEntry" ADD COLUMN "activities" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "WorklogEntry" ADD COLUMN "totalHours" DECIMAL(6,2) NOT NULL DEFAULT 0;

UPDATE "WorklogEntry"
SET "totalHours" = "workingHours",
    "activities" = jsonb_build_array(
      jsonb_build_object(
        'label',    "deliverable",
        'quantity', "deliverableQuantity",
        'hours',    "workingHours"
      )
    );

DROP INDEX IF EXISTS "WorklogEntry_logDate_idx";
ALTER TABLE "WorklogEntry" DROP COLUMN "deliverable";
ALTER TABLE "WorklogEntry" DROP COLUMN "deliverableQuantity";
ALTER TABLE "WorklogEntry" DROP COLUMN "workingHours";

ALTER TABLE "AiInsightCache" RENAME COLUMN "rawContext" TO "contextSnapshot";

DROP TABLE IF EXISTS "DayExtraction";
DROP TYPE  IF EXISTS "DayExtractionStatus";
