-- The worklog row becomes the four fields the form actually collects, and the
-- parsed structure moves to a table of its own.
--
-- ── Why the shape moved again ────────────────────────────────────────────────
-- Holding a JSON array of activities put a parser between somebody and their own
-- words: the stored row became a claim about what they meant rather than a record
-- of what they wrote. Structure is now derived AFTER the fact, into
-- `DayExtraction`, where it can be wrong without damaging the record.
--
-- `workingHours` is the day total the instructor entered separately. That
-- separateness is the point — it is independent of whatever the text says, so an
-- extraction can be reconciled against it, and hours the text attributes to
-- nothing become a visible difference rather than a silent one.
--
-- Nothing is deleted or altered here. The four fields are backfilled from what is
-- already stored, reconciled, and only then are the old columns dropped.

-- ── 1. The new columns, nullable while they are filled ──────────────────────
ALTER TABLE "WorklogEntry" ADD COLUMN "deliverable"         TEXT;
ALTER TABLE "WorklogEntry" ADD COLUMN "deliverableQuantity" TEXT;
ALTER TABLE "WorklogEntry" ADD COLUMN "workingHours"        DECIMAL(6,2);

-- ── 2. Backfill from the activities array ───────────────────────────────────
-- Labels joined in array order with ", ", which is how the day reads back as one
-- description. Quantities joined the same way, so "2 classes" and "1 meeting"
-- both survive as the corroborating note they were.
--
-- `WITH ORDINALITY` because the order activities were written in is part of what
-- was written, and `jsonb_array_elements` gives no ordering guarantee on its own.
UPDATE "WorklogEntry" e
SET "deliverable" = coalesce(sub.labels, ''),
    "deliverableQuantity" = sub.quantities,
    "workingHours" = e."totalHours"
FROM (
  SELECT e2."id" AS entry_id,
         string_agg(item->>'label',    ', ' ORDER BY idx) AS labels,
         nullif(string_agg(item->>'quantity', ', ' ORDER BY idx), '') AS quantities
  FROM "WorklogEntry" e2
  CROSS JOIN LATERAL jsonb_array_elements(e2."activities") WITH ORDINALITY AS t(item, idx)
  GROUP BY e2."id"
) sub
WHERE e."id" = sub.entry_id;

-- A day with an empty array still needs a value for a NOT NULL column.
UPDATE "WorklogEntry" SET "deliverable" = '' WHERE "deliverable" IS NULL;
UPDATE "WorklogEntry" SET "workingHours" = coalesce("totalHours", 0) WHERE "workingHours" IS NULL;

-- ── 3. Reconcile, and ABORT rather than correct ─────────────────────────────
-- Hours must survive the move exactly, and every row must have gained a
-- description. A silent correction here would be this migration deciding what
-- somebody recorded.
DO $$
DECLARE bad_hours bigint; missing bigint; lost_labels bigint;
BEGIN
  SELECT count(*) INTO bad_hours FROM "WorklogEntry"
  WHERE abs(coalesce("workingHours", 0) - coalesce("totalHours", 0)) > 0.01;
  IF bad_hours > 0 THEN
    RAISE EXCEPTION 'Working hours do not reconcile on % rows', bad_hours;
  END IF;

  SELECT count(*) INTO missing FROM "WorklogEntry" WHERE "deliverable" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION '% rows have no deliverable text', missing;
  END IF;

  -- Every label that was in the array must appear in the joined text. Catches a
  -- join that dropped an item rather than merely reordering it.
  SELECT count(*) INTO lost_labels FROM (
    SELECT e."id"
    FROM "WorklogEntry" e
    CROSS JOIN LATERAL jsonb_array_elements(e."activities") AS item
    WHERE coalesce(item->>'label', '') <> ''
      AND position(item->>'label' IN e."deliverable") = 0
  ) x;
  IF lost_labels > 0 THEN
    RAISE EXCEPTION '% activity labels did not survive the join', lost_labels;
  END IF;
END $$;

-- ── 4. Constrain, then drop ─────────────────────────────────────────────────
ALTER TABLE "WorklogEntry" ALTER COLUMN "deliverable"  SET NOT NULL;
ALTER TABLE "WorklogEntry" ALTER COLUMN "workingHours" SET NOT NULL;
ALTER TABLE "WorklogEntry" ALTER COLUMN "workingHours" SET DEFAULT 0;

ALTER TABLE "WorklogEntry" DROP COLUMN "activities";
ALTER TABLE "WorklogEntry" DROP COLUMN "totalHours";

-- A manager's period view reads by date across instructors.
CREATE INDEX "WorklogEntry_logDate_idx" ON "WorklogEntry"("logDate");

-- ── 5. The frozen copy is named for what it is ──────────────────────────────
ALTER TABLE "AiInsightCache" RENAME COLUMN "contextSnapshot" TO "rawContext";

-- ── 6. Parsed structure per day, created empty ──────────────────────────────
-- Not backfilled: extraction is lazy and happens the first time somebody opens a
-- day. Backfilling would be a paid call for every day nobody has looked at.
CREATE TYPE "DayExtractionStatus" AS ENUM ('READY', 'FAILED');

CREATE TABLE "DayExtraction" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "logDate" DATE NOT NULL,
    "sourceHash" CHAR(64) NOT NULL,
    "rawContext" JSONB NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "unallocatedHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "status" "DayExtractionStatus" NOT NULL DEFAULT 'READY',
    "promptVersion" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayExtraction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DayExtraction_instructorId_logDate_key"
  ON "DayExtraction"("instructorId", "logDate");

ALTER TABLE "DayExtraction" ADD CONSTRAINT "DayExtraction_instructorId_fkey"
  FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
