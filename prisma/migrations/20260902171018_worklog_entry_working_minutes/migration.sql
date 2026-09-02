-- The day's total moves from Decimal(6,2) HOURS to whole MINUTES.
--
-- Decimal(6,2) cannot hold a third of an hour. Twenty minutes stored as 0.33,
-- which is 19.8 minutes, and the loss compounded: three twenty-minute days
-- summed to 0.99h through the record and to 60 minutes through anything
-- counting in minutes, so two surfaces reading one day disagreed.
--
-- The old column is dropped in this migration rather than left behind, but only
-- after every row has been shown to survive the conversion. A column kept "just
-- in case" is a second answer to the same question, which is the shape of the
-- bug this removes.

ALTER TABLE "WorklogEntry" ADD COLUMN "workingMinutes" INTEGER NOT NULL DEFAULT 0;

UPDATE "WorklogEntry" SET "workingMinutes" = ROUND("workingHours" * 60);

-- Every row, or none. Converting minutes back to two-decimal hours must give
-- exactly what was stored; anything finer than a minute never round-trips and
-- must stop the migration rather than be silently rounded away.
DO $$
DECLARE
  bad_rows INTEGER;
  example TEXT;
BEGIN
  SELECT COUNT(*) INTO bad_rows
    FROM "WorklogEntry"
   WHERE ROUND(("workingMinutes"::numeric) / 60, 2) <> "workingHours";

  IF bad_rows > 0 THEN
    SELECT string_agg(format('%s (%s h -> %s min)', id, "workingHours", "workingMinutes"), ', ')
      INTO example
      FROM (
        SELECT id, "workingHours", "workingMinutes"
          FROM "WorklogEntry"
         WHERE ROUND(("workingMinutes"::numeric) / 60, 2) <> "workingHours"
         LIMIT 5
      ) s;
    RAISE EXCEPTION
      'workingHours -> workingMinutes round trip failed on % row(s): %', bad_rows, example;
  END IF;
END $$;

ALTER TABLE "WorklogEntry" DROP COLUMN "workingHours";
