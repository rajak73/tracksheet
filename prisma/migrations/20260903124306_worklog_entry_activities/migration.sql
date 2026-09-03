-- Activity rows, authored by the instructor rather than parsed out of prose.
--
-- Null on every existing row, deliberately. Legacy days keep their `deliverable`
-- and `deliverableQuantity` text exactly as written, and nothing backfills them
-- into this shape: a positional pairing that was never stated cannot be
-- recovered by a migration, and inventing one is the defect this column exists
-- to end rather than to formalise.
ALTER TABLE "WorklogEntry" ADD COLUMN "activities" JSONB;
