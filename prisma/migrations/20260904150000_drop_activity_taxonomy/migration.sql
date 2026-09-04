-- The activity taxonomy, dropped.
--
-- `ActivityType` (16 rows) and `DeliverableType` (44) were the fixed set of
-- work types this product spent months removing from every screen, prompt and
-- response. Nothing read them for data any more: the last readers were a
-- countability flag that always answered true, a once-per-day rule that one row
-- per instructor per day makes structurally true, and a route that no longer
-- exists.
--
-- Reversible: `WorklogActivityArchive` holds the activity and deliverable code
-- and label for every `ActivityLog` row that ever had one. Verified before
-- writing this — 122 of 122 rows archived, and all 11 types referenced by live
-- rows present in the archive.

ALTER TABLE "ActivityLog" DROP CONSTRAINT IF EXISTS "ActivityLog_activityTypeId_fkey";
ALTER TABLE "ActivityLog" DROP CONSTRAINT IF EXISTS "ActivityLog_deliverableTypeId_fkey";
ALTER TABLE "ScheduleSlot" DROP CONSTRAINT IF EXISTS "ScheduleSlot_activityTypeId_fkey";
ALTER TABLE "DeliverableType" DROP CONSTRAINT IF EXISTS "DeliverableType_activityTypeId_fkey";

ALTER TABLE "ActivityLog" DROP COLUMN IF EXISTS "activityTypeId";
ALTER TABLE "ActivityLog" DROP COLUMN IF EXISTS "deliverableTypeId";
ALTER TABLE "ScheduleSlot" DROP COLUMN IF EXISTS "activityTypeId";

DROP TABLE IF EXISTS "DeliverableType";
DROP TABLE IF EXISTS "ActivityType";

-- Renamed, not dropped. A table that is still there is a five-second revert;
-- a dropped one is a restore from backup. Drop it next time this schema moves.
ALTER TABLE "ActivityLog" RENAME TO "ActivityLog_deprecated";
