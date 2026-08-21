-- Reading a paragraph, not only a list of lines.
--
-- Additive throughout: an existing submission keeps its status and becomes
-- BULLETS, which is exactly what it was. Nothing is rewritten and nothing is
-- dropped.

-- A read that is running right now, as opposed to one not started yet.
ALTER TYPE "WorklogParseStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

CREATE TYPE "WorklogInputMode" AS ENUM ('BULLETS', 'NARRATIVE');

ALTER TABLE "WorklogSubmission"
  ADD COLUMN "inputMode" "WorklogInputMode" NOT NULL DEFAULT 'BULLETS';
