-- `utilizationPercent` becomes `recordedHoursPercent`, because the question it
-- answers changed and its name did not.
--
-- ── What changed underneath it ─────────────────────────────────────────────
-- The column was recorded-productive minutes over capacity, where "productive"
-- excluded any activity type flagged `countsAsProductive: false` — UNUTILIZED
-- being the one that was. With the taxonomy gone there is no field that can
-- mark an hour as recorded-but-not-work, so every recorded hour counts.
--
-- So it used to answer "how much of the time they logged was productive?" and
-- now answers "how many hours did they log against their capacity?". Those are
-- different questions, and on the dev set the same person moves from 18.75% to
-- 21.25% without having worked a minute differently.
--
-- A number whose meaning changes while its name does not is how a metric lies
-- quietly: somebody comparing this month to last reads a real 2.5-point rise
-- that is entirely definitional. The rename is the fix, and it lands in one
-- commit with the API property and the CSV header so nothing is left reading
-- the old name.
--
-- If a productive-versus-unutilised distinction is genuinely wanted, it needs a
-- mechanism that is not a list of types. That is a separate conversation, and
-- keeping two codes alive to preserve it is exactly what this stage removed.

ALTER TABLE "InstructorDailyMetric"  RENAME COLUMN "utilizationPercent" TO "recordedHoursPercent";
ALTER TABLE "InstructorWeeklyMetric" RENAME COLUMN "utilizationPercent" TO "recordedHoursPercent";
ALTER TABLE "UniversityDailyMetric"  RENAME COLUMN "utilizationPercent" TO "recordedHoursPercent";
