-- "Organised, but please look at it" — the state between a clean read and a
-- failed one. Additive: existing rows keep needsReview = false and no notes,
-- which is what they are.
ALTER TABLE "WorklogSubmission" ADD COLUMN "reviewNotes" JSONB;
