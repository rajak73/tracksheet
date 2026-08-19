-- Whether a COUNT of a deliverable means anything. Preparation, meetings,
-- reporting and admin are effort with hours but no unit, so the client's sheet
-- reports their hours and omits them from the quantity column.
--
-- Additive with a default, so every existing row keeps counting until the seed
-- marks the effort-shaped ones.
ALTER TABLE "DeliverableType" ADD COLUMN "isCountable" BOOLEAN NOT NULL DEFAULT true;
