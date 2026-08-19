-- Manager → Instructor ownership.
--
-- Until now Manager and Instructor were siblings under University: a manager's
-- scope was the whole tenant, so two managers in one university necessarily saw
-- the same roster. The product needs each manager to lead a distinct set of
-- people, which no existing column can express.
--
-- Every statement here is additive. No table is dropped, no column is dropped,
-- no row is written. Existing instructors keep managerId = NULL, which reads as
-- "not yet assigned" — ownership is assigned by an admin, never inferred, and
-- backfilling from University.primaryManagerId would have invented assignments
-- for the universities that already have two managers.

-- AlterTable
ALTER TABLE "Instructor" ADD COLUMN     "managerId" TEXT;

-- CreateIndex
CREATE INDEX "Instructor_managerId_idx" ON "Instructor"("managerId");

-- CreateIndex
-- Target for the composite foreign key below. "id" is already the primary key,
-- so this adds no business constraint; it exists so PostgreSQL can reference
-- the (id, universityId) pair.
CREATE UNIQUE INDEX "Manager_id_universityId_key" ON "Manager"("id", "universityId");

-- AddForeignKey
-- COMPOSITE on purpose. Referencing (managerId, universityId) rather than
-- managerId alone means the database itself refuses an instructor whose manager
-- belongs to a different university — cross-tenant assignment is impossible,
-- not merely guarded against in application code. Same technique the existing
-- Instructor/Manager → User foreign keys already use.
--
-- RESTRICT rather than SET NULL: on a composite key SET NULL would null BOTH
-- columns, and "universityId" is NOT NULL. Managers are deactivated rather than
-- deleted, so nothing legitimate is blocked.
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_managerId_universityId_fkey" FOREIGN KEY ("managerId", "universityId") REFERENCES "Manager"("id", "universityId") ON DELETE RESTRICT ON UPDATE CASCADE;
