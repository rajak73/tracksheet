-- DayExtraction moves to whole minutes, and records which check refused it.
--
-- Nothing has ever written this table: `checkExtraction` had no caller and no
-- code path created a row. The conversion is therefore exact by construction,
-- but it is written as a conversion rather than a drop-and-add so that it stays
-- correct if that ever stops being true.

ALTER TABLE "DayExtraction" ADD COLUMN "unallocatedMinutes" INTEGER NOT NULL DEFAULT 0;
UPDATE "DayExtraction" SET "unallocatedMinutes" = ROUND("unallocatedHours" * 60);

DO $$
DECLARE bad_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_rows
    FROM "DayExtraction"
   WHERE ROUND(("unallocatedMinutes"::numeric) / 60, 2) <> "unallocatedHours";
  IF bad_rows > 0 THEN
    RAISE EXCEPTION 'unallocatedHours -> unallocatedMinutes round trip failed on % row(s)', bad_rows;
  END IF;
END $$;

ALTER TABLE "DayExtraction" DROP COLUMN "unallocatedHours";
ALTER TABLE "DayExtraction" ADD COLUMN "lastError" TEXT;
