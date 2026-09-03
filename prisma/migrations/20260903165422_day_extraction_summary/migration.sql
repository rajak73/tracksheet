-- The day in words: grouped bullets and one sentence about the day.
--
-- Prose only. Every figure rendered beside a bullet is summed in code from the
-- activities that bullet names; the model is refused if its reply contains a
-- digit at all.
ALTER TABLE "DayExtraction" ADD COLUMN "summary" JSONB;
