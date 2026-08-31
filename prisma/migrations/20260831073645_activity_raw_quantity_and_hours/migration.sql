-- What the instructor actually TYPED into the Quantity and Working Hours boxes.
--
-- Additive and nullable. Every existing row keeps its parsed `quantity` and its
-- `startTime`/`endTime`, which remain the authority for all arithmetic; these
-- two carry the words beside them so a table can print what somebody wrote
-- rather than what the parser made of it.
--
-- Not backfilled, and deliberately: the original text is not recoverable from
-- the parse — "2" and "2 classes" both stored 2 — so inventing it would be
-- guessing. A row from before this migration reads NULL, and every screen falls
-- back to the computed figure, which is what it showed before anyway.

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "rawQuantity" TEXT,
ADD COLUMN     "rawWorkingHours" TEXT;
