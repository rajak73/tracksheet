-- Down migration for 20260901051959_ai_insight_cache.
--
-- Prisma does not run these itself — apply it by hand when reverting:
--   psql "$DATABASE_URL" -f prisma/migrations/20260901051959_ai_insight_cache/down.sql
-- and then delete the row for this migration from "_prisma_migrations".
--
-- Safe to run at any time. The table holds only derived, regenerable data: every
-- row can be rebuilt by opening the period it describes. No worklog entry, date
-- or duration is touched.

DROP TABLE IF EXISTS "AiInsightCache";
DROP TYPE IF EXISTS "InsightCacheStatus";
DROP TYPE IF EXISTS "InsightScopeType";
