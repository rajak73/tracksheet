-- Departure becomes a fact on the person, not only a line in the audit log.
--
-- `isActive` already answered the security question ("can they sign in") and the
-- login route and session validation both honour it. What was missing was the
-- operational one: WHO left, WHEN, and WHY. That was recoverable only by reading
-- the audit trail, which is not a list anybody can filter or sort.
--
-- Nothing is deleted here and nothing ever will be: the account, its profile,
-- its recorded work and its audit entries all stay. This marks the row, it does
-- not remove it.
ALTER TABLE "User" ADD COLUMN "leftReason" TEXT;

-- The leavers list is a filter on deletedAt, so it should not be a table scan.
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- Backfill: anyone already deactivated left at some point, and the honest date
-- is the one the audit log recorded for it. Where no audit entry exists the
-- column stays NULL — an unknown departure date is a truthful unknown, and
-- stamping `now()` on it would invent a fact about a real person.
UPDATE "User" u
SET "deletedAt" = a."createdAt"
FROM (
  SELECT "entityId", MAX("createdAt") AS "createdAt"
  FROM "AuditLog"
  WHERE "action" = 'STAFF_DEACTIVATED' AND "entityType" = 'User'
  GROUP BY "entityId"
) a
WHERE u."id" = a."entityId"
  AND u."isActive" = false
  AND u."deletedAt" IS NULL;
