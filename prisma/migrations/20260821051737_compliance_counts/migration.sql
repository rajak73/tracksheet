-- The counts a compliance percentage is made of.
--
-- A period's compliance is not the average of its days' compliance: the live
-- engine divides openings by expected instructor-days across the whole period,
-- and the dashboard averaged the stored daily percentages. An unweighted mean
-- of ratios disagrees with a ratio of sums whenever the denominators differ,
-- which approved leave and part-week holidays guarantee.
--
-- Additive and defaulted, so existing rows stay readable. They report zero
-- until the next rollup passes over them, which the scheduler does on a rolling
-- window; an explicit recompute fills any older period.
ALTER TABLE "UniversityDailyMetric"
  ADD COLUMN "openingsLogged"         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "closingsLogged"         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "expectedInstructorDays" INTEGER NOT NULL DEFAULT 0;
