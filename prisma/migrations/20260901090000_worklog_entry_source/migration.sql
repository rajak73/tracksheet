-- Where a day's text came from.
--
-- The collapse built `deliverable` for legacy rows out of the deliverable and
-- category LABELS being dropped, because those rows never held the instructor's
-- own words. A migrated day can therefore read "Live Class Delivery" — phrasing
-- no instructor uses — and that text feeds extraction, so the insight echoes the
-- taxonomy this project removed.
--
-- Nothing about that is broken. It must simply not be invisible.
--
-- The text is NOT rewritten, paraphrased or tidied to read more naturally. It is
-- a record of what the old system held, and improving it would replace a true
-- record with a plausible one.

CREATE TYPE "WorklogEntrySource" AS ENUM ('NATIVE', 'MIGRATED');

ALTER TABLE "WorklogEntry"
  ADD COLUMN "source" "WorklogEntrySource" NOT NULL DEFAULT 'NATIVE';

-- A day is MIGRATED when ANY of the activity rows it was built from had no raw
-- text — that is precisely when the collapse reached for a taxonomy label. Not
-- "all of them": one such row is enough for the joined text to carry vocabulary
-- the instructor never used, which is the thing worth marking.
UPDATE "WorklogEntry" e
SET "source" = 'MIGRATED'
WHERE EXISTS (
  SELECT 1 FROM "ActivityLog" a
  WHERE a."instructorId" = e."instructorId"
    AND a."workDate" = e."logDate"
    AND coalesce(btrim(a."rawText"), '') = ''
);
