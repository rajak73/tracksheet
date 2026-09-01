-- Down migration for 20260901055626_worklog_entry_one_row_per_day.
--
-- Prisma does not run these itself. Apply by hand when reverting:
--   psql "$DATABASE_URL" -f prisma/migrations/20260901055626_worklog_entry_one_row_per_day/down.sql
-- then delete this migration's row from "_prisma_migrations".
--
-- Safe because the up-migration DROPPED NOTHING. `ActivityLog` and the taxonomy
-- tables are still present and still the shape they were, so reversing means
-- discarding the derived copy and the archive — no worklog data is lost, because
-- none was moved out of its original home.
--
-- If a later migration has already dropped `ActivityLog`, this is not enough on
-- its own: restore that table first, from the archive and a backup, before
-- running this.

DROP TABLE IF EXISTS "WorklogActivityArchive";
DROP TABLE IF EXISTS "WorklogEntry";
DROP TYPE  IF EXISTS "WorklogEntryStatus";
