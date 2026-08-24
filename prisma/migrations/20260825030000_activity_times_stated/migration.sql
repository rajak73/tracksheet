-- Whether an activity's clock range was STATED by the instructor or placed by us.
--
-- Additive and false-by-default: a row written before this column existed
-- carries no evidence either way, and "we placed it" is the honest reading of
-- no evidence — it makes a reader show the duration rather than assert a time
-- nobody may have given.
ALTER TABLE "ActivityLog" ADD COLUMN "timesStated" BOOLEAN NOT NULL DEFAULT false;

-- Backfill the narrative rows. Those came from a WorklogSubmission, where the
-- parser read times out of the sentence, so most of them did carry a real
-- range. It is an approximation for legacy data and is stated as one: a
-- duration-only line inside a narrative is marked stated here when it was not.
-- Nothing written after this migration relies on the guess.
UPDATE "ActivityLog" SET "timesStated" = true WHERE "submissionId" IS NOT NULL;
