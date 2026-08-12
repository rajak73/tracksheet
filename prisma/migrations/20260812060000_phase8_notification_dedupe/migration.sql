-- Dedupe key for recurring notifications.
-- Nullable and new, so every existing row is NULL. Postgres does not treat
-- NULLs as equal in a unique index, so the constraint cannot conflict with
-- existing data — which is why Prisma's generic warning does not apply here.
-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

