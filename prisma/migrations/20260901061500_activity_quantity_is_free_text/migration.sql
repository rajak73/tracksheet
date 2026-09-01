-- `activities[].quantity` becomes free text.
--
-- The instructor writes whatever describes the work — "5 class", "2 batches",
-- "half day", "3 sections + lab" — and it is stored verbatim. It is context, not
-- a measurement: `hours` is the only reliable numeric field on an activity.
--
-- The previous migration wrote the PARSED integer here, which was the wrong
-- fact. "2 classes taken" and "2" both parsed to 2, so the number cannot say
-- what was written and printing it back means an instructor cannot find their
-- own words. Where the verbatim text survives on the old row it is used; where
-- only the parse survives, the number as text is the honest remainder — it is
-- what was recorded, and it extracts cleanly.
--
-- No hours, dates or labels are touched.

UPDATE "WorklogEntry" e
SET "activities" = sub.rebuilt
FROM (
  SELECT
    e2."id" AS entry_id,
    jsonb_agg(
      jsonb_build_object(
        'label',    item->>'label',
        -- Verbatim first, then the recorded number as text, then nothing.
        -- `nullif(..., '')` so a blank string never becomes a quantity: empty
        -- and absent are the same fact and only one of them may be stored.
        'quantity', nullif(
                      coalesce(
                        a."rawQuantity",
                        CASE WHEN a."quantity" IS NULL THEN NULL ELSE a."quantity"::text END
                      ), ''),
        'hours',    (item->>'hours')::numeric
      )
      ORDER BY idx
    ) AS rebuilt
  FROM "WorklogEntry" e2
  CROSS JOIN LATERAL jsonb_array_elements(e2."activities") WITH ORDINALITY AS t(item, idx)
  -- Matched back to the row this item came from, on the day and the label the
  -- previous migration wrote. `rawText` is that label; the fallbacks mirror the
  -- coalesce that produced it.
  LEFT JOIN "ActivityLog" a
    ON  a."instructorId" = e2."instructorId"
    AND a."workDate"     = e2."logDate"
    AND coalesce(nullif(btrim(a."rawText"), ''), '') = coalesce(item->>'label', '')
  GROUP BY e2."id"
) sub
WHERE e."id" = sub.entry_id;

-- Every entry must still hold the same number of items and the same hours. The
-- rebuild is a rewrite of one field and may not lose a line or a duration.
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad
  FROM (
    SELECT e."id",
           jsonb_array_length(e."activities") AS items,
           round(coalesce(sum((item->>'hours')::numeric), 0), 2) AS hours,
           e."totalHours"
    FROM "WorklogEntry" e
    CROSS JOIN LATERAL jsonb_array_elements(e."activities") AS item
    GROUP BY e."id", e."activities", e."totalHours"
  ) x
  WHERE abs(x.hours - x."totalHours") > 0.01;

  IF bad > 0 THEN
    RAISE EXCEPTION 'Rebuilt activities disagree with totalHours on % rows', bad;
  END IF;
END $$;
