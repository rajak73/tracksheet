-- Migrated days carry each activity's quantity beside its own description.
--
-- ── The defect ──────────────────────────────────────────────────────────────
-- The old model held (description, quantity) as PAIRS, one per activity row.
-- The collapse joined the descriptions into one string and the quantities into
-- another, independently:
--
--   deliverable          : "Lecture, mentored 3 final year students…, took java 5 to 6"
--   deliverableQuantity  : "3, 25, 1, 1, 6"
--
-- The pairing is destroyed at that moment and cannot be recovered from the
-- result. "3, 25, 1, 1, 6" is not a note any instructor wrote; it is an artefact
-- of the join. Digit provenance then passes for ANY of those numbers against ANY
-- activity, because provenance tests presence and every one of them is present.
--
-- That is a migration bug, not an extraction bug, so it is fixed here.
--
-- ── A second bug, found while fixing the first ──────────────────────────────
-- `20260901061500_activity_quantity_is_free_text` rebuilt each item's quantity by
-- matching back to `ActivityLog` on
--
--   coalesce(nullif(btrim(a."rawText"), ''), '') = coalesce(item->>'label', '')
--
-- Its comment says the fallbacks mirror the coalesce that produced the label.
-- They do not: the label fell back to the deliverable's name and then the
-- activity type's, and this fell back to the empty string. So every row whose
-- label came from the TAXONOMY matched nothing and lost its quantity — which is
-- precisely the set of rows that make a day MIGRATED. The example above shows it:
-- six activities, five quantities, and the missing one belongs to "Lecture".
--
-- Rebuilding from `ActivityLog` with the correct expression restores those.
--
-- ── What is written ────────────────────────────────────────────────────────
--   deliverable          : "Lecture — 1; mentored 3 final year students… — 3"
--   deliverableQuantity  : NULL
--
-- One separator between activities (`; `) and one between an activity and its
-- quantity (` — `). Where a source row had no quantity, the quantity portion is
-- omitted entirely: no `— null`, no `— 0`.
--
-- `deliverableQuantity` is NULL because the old model had no day-level quantity.
-- Concatenating per-activity counts into one and calling it the day's would
-- misrepresent what was recorded.
--
-- The TEXT ITSELF IS NOT EDITED. A taxonomy label sitting inside instructor prose
-- — "Lecture" opening an 18 Aug entry — stays exactly where it is. It is a record
-- of what the old system held, and tidying it turns a record into a
-- reconstruction. `WorklogEntry.source` exists to explain it.
--
-- ── What is not touched ────────────────────────────────────────────────────
-- NATIVE days. Their `deliverable` is what the instructor typed and their
-- `deliverableQuantity` is what they put in that box. Neither is rewritten here,
-- and the reconciliation below aborts if either moves.

-- ── 1. Refuse to run on a row that has changed since the collapse ───────────
-- A day is rebuilt only if its stored `deliverable` is still exactly the unpaired
-- join of its current `ActivityLog` rows. That equality is the proof that nothing
-- has edited the day and that the source rows still correspond to it. Anything
-- else is left alone and counted, because rebuilding a day somebody has since
-- rewritten would overwrite their words with a reconstruction.
CREATE TEMP TABLE _pairing AS
WITH src AS (
  SELECT
    a."instructorId",
    a."workDate",
    string_agg(
      coalesce(nullif(btrim(a."rawText"), ''), d."label", t."label"),
      ', ' ORDER BY a."startTime", a."id"
    ) AS unpaired,
    string_agg(
      coalesce(nullif(btrim(a."rawText"), ''), d."label", t."label")
        || coalesce(
             ' — ' || nullif(btrim(coalesce(a."rawQuantity", a."quantity"::text)), ''),
             ''
           ),
      '; ' ORDER BY a."startTime", a."id"
    ) AS paired
  FROM "ActivityLog" a
  LEFT JOIN "ActivityType"    t ON t."id" = a."activityTypeId"
  LEFT JOIN "DeliverableType" d ON d."id" = a."deliverableTypeId"
  GROUP BY 1, 2
)
SELECT e."id" AS entry_id, s.paired
FROM "WorklogEntry" e
JOIN src s ON s."instructorId" = e."instructorId" AND s."workDate" = e."logDate"
WHERE e."source" = 'MIGRATED'
  AND e."deliverable" = s.unpaired;

-- A snapshot of every NATIVE day, so "no native day changed" is CHECKED rather
-- than argued from the WHERE clause above. The clause is the reason it should
-- hold; this is the evidence that it did.
CREATE TEMP TABLE _native_before AS
SELECT "id", "deliverable", "deliverableQuantity"
FROM "WorklogEntry" WHERE "source" = 'NATIVE';

-- ── 2. Rebuild ──────────────────────────────────────────────────────────────
UPDATE "WorklogEntry" e
SET "deliverable" = p.paired,
    "deliverableQuantity" = NULL
FROM _pairing p
WHERE e."id" = p.entry_id;

-- ── 3. Reconcile, and ABORT rather than correct ─────────────────────────────
DO $$
DECLARE
  skipped bigint; lost bigint; digits bigint; artefacts bigint; touched bigint;
BEGIN
  -- Migrated days that did not meet the guard. Not an error — a day somebody has
  -- rewritten SHOULD be skipped — but it must be said out loud rather than
  -- discovered later as a row that still carries a digit list.
  SELECT count(*) INTO skipped
  FROM "WorklogEntry" e
  WHERE e."source" = 'MIGRATED'
    AND NOT EXISTS (SELECT 1 FROM _pairing p WHERE p.entry_id = e."id");
  IF skipped > 0 THEN
    RAISE NOTICE '% migrated days were left alone: their text no longer matches their source rows', skipped;
  END IF;

  -- Every activity label must still appear in the rebuilt text. Catches a join
  -- that dropped a line rather than merely reordering it.
  SELECT count(*) INTO lost FROM (
    SELECT e."id"
    FROM "WorklogEntry" e
    JOIN _pairing p ON p.entry_id = e."id"
    JOIN "ActivityLog" a
      ON a."instructorId" = e."instructorId" AND a."workDate" = e."logDate"
    LEFT JOIN "ActivityType"    t ON t."id" = a."activityTypeId"
    LEFT JOIN "DeliverableType" d ON d."id" = a."deliverableTypeId"
    WHERE position(
            coalesce(nullif(btrim(a."rawText"), ''), d."label", t."label") IN e."deliverable"
          ) = 0
  ) x;
  IF lost > 0 THEN
    RAISE EXCEPTION '% activity labels did not survive the pairing', lost;
  END IF;

  -- No rebuilt day may still carry a bare digit list as its day quantity. This
  -- is the defect itself, asserted gone.
  SELECT count(*) INTO digits
  FROM "WorklogEntry" e
  JOIN _pairing p ON p.entry_id = e."id"
  WHERE e."deliverableQuantity" IS NOT NULL;
  IF digits > 0 THEN
    RAISE EXCEPTION '% rebuilt days still carry a day-level quantity', digits;
  END IF;

  -- Not one NATIVE day may have moved. Their text is what somebody typed.
  SELECT count(*) INTO touched
  FROM _native_before b
  JOIN "WorklogEntry" e ON e."id" = b."id"
  WHERE e."deliverable" IS DISTINCT FROM b."deliverable"
     OR e."deliverableQuantity" IS DISTINCT FROM b."deliverableQuantity";
  IF touched > 0 THEN
    RAISE EXCEPTION '% native days were altered by a migration that must not touch them', touched;
  END IF;

  -- No separator artefact from a source row that had no quantity.
  SELECT count(*) INTO artefacts
  FROM "WorklogEntry" e
  JOIN _pairing p ON p.entry_id = e."id"
  WHERE e."deliverable" LIKE '%— ;%'
     OR e."deliverable" LIKE '%— null%'
     OR right(e."deliverable", 2) = '— ';
  IF artefacts > 0 THEN
    RAISE EXCEPTION '% rebuilt days carry an empty quantity separator', artefacts;
  END IF;
END $$;

DROP TABLE _pairing;
DROP TABLE _native_before;
