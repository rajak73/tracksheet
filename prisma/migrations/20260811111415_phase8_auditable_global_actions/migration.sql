-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ALTER COLUMN "universityId" DROP NOT NULL;
