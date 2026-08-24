-- Active-Instructor Average Hours: the two numbers the rollup now precomputes
-- so a Week or Month view is a handful of indexed reads, never a scan.
--
-- "Active" on a day = that instructor's productiveMinutes was > 0. Additive
-- and zero-default, so every existing row reads as "nobody active" until the
-- next rollup pass recomputes it — the scheduler's trailing window reaches
-- every row again within its normal cadence; nothing here is destructive.
ALTER TABLE "UniversityDailyMetric" ADD COLUMN "activeInstructorMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UniversityDailyMetric" ADD COLUMN "activeInstructorCount" INTEGER NOT NULL DEFAULT 0;
