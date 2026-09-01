-- `InstructorCategory` goes: its values are kinds of work, not designations.
--
-- ── The check that decided it ───────────────────────────────────────────────
-- The question was whether this column is an HR attribute about a person's role
-- — Assistant Professor, visiting, contract, a grade band — in which case it
-- stays, because deleting a designation field breaks user management for reasons
-- unrelated to anything this project set out to change.
--
-- The distinct values are:
--
--   TECH (Technical) · MATH (Mathematics) · ENGLISH (English) · APTITUDE
--   (Aptitude) · PHYSICS (Physics) · CHEMISTRY (Chemistry) · OTHERS (Others)
--
-- Subjects. Kinds of work. So it goes with the rest of the taxonomy.
--
-- ── The 15 assignments are archived first ──────────────────────────────────
-- `WorklogActivityArchive` holds the broad category of each ACTIVITY, which is a
-- different fact from the subject a PERSON was filed under. That second fact
-- existed nowhere else, so it is written to
-- `archive/instructor-assigned-category-20260902.json` before this runs —
-- somebody chose those, and the record of what they chose costs nothing to keep
-- and is gone forever otherwise.

-- The FK first, then the column, then the table.
ALTER TABLE "Instructor" DROP CONSTRAINT IF EXISTS "Instructor_categoryId_fkey";
ALTER TABLE "Instructor" DROP COLUMN IF EXISTS "categoryId";

-- `ActivityLog.broadCategoryId` pointed at the same table: the subject a model
-- read off one line of somebody's text. The column goes with the classification.
ALTER TABLE "ActivityLog" DROP CONSTRAINT IF EXISTS "ActivityLog_broadCategoryId_fkey";
DROP INDEX IF EXISTS "ActivityLog_broadCategoryId_idx";
ALTER TABLE "ActivityLog" DROP COLUMN IF EXISTS "broadCategoryId";

DROP TABLE IF EXISTS "InstructorCategory";
