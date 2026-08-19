-- Why a bullet produced no activity, kept so the instructor is told what to fix
-- rather than only that something is missing. Additive and nullable: existing
-- submissions read as "no rejections recorded", which is what they are.
ALTER TABLE "WorklogSubmission" ADD COLUMN "rejections" JSONB;
