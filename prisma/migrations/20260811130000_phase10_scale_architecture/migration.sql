-- Phase 10 — scale architecture.
--
-- Safe against a populated database (§61): every column that ends up NOT NULL
-- on an existing table is added nullable, backfilled from real data, and only
-- then constrained. Nothing is dropped that still holds meaning — the
-- DeliverableLog date column is RENAMED rather than dropped and re-added.

-- CreateEnum
CREATE TYPE "UniversityStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('SYSTEM', 'SCHEDULE', 'INSTRUCTOR', 'MANAGER', 'IMPORT', 'API');

-- CreateEnum
CREATE TYPE "DeliverableStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InsightScope" AS ENUM ('PLATFORM', 'UNIVERSITY', 'MANAGER', 'INSTRUCTOR');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'UNPAID', 'BEREAVEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "HolidayType" AS ENUM ('PUBLIC', 'UNIVERSITY', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "TermStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduleSlotStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReportingPeriodType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- DropIndex
DROP INDEX "ActivityLog_universityId_idx";

-- DropIndex
DROP INDEX "AiInsight_universityId_idx";

-- DropIndex
DROP INDEX "AuditLog_universityId_idx";

-- DropIndex
DROP INDEX "AuditLog_userId_idx";

-- DropIndex
DROP INDEX "Deliverable_instructorId_idx";

-- DropIndex
DROP INDEX "Deliverable_universityId_idx";

-- DropIndex
DROP INDEX "DeliverableLog_deliverableId_idx";

-- DropIndex
DROP INDEX "Notification_userId_idx";

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "deliverableId" TEXT,
ADD COLUMN     "scheduleSlotId" TEXT,
ADD COLUMN     "source" "ActivitySource" NOT NULL DEFAULT 'INSTRUCTOR';

-- AlterTable
ALTER TABLE "AiInsight" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "instructorId" TEXT,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "periodEnd" DATE,
ADD COLUMN     "periodStart" DATE,
ADD COLUMN     "scope" "InsightScope" NOT NULL DEFAULT 'UNIVERSITY',
ADD COLUMN     "sourceMetrics" JSONB,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "title" TEXT,
ALTER COLUMN "universityId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Deliverable" ADD COLUMN     "category" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "status_new" "DeliverableStatus" NOT NULL DEFAULT 'NOT_STARTED';

-- AlterTable
ALTER TABLE "DeliverableLog" RENAME COLUMN "date" TO "workDate";
ALTER TABLE "DeliverableLog"
  ADD COLUMN "instructorId" TEXT,
  ADD COLUMN "universityId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "universityId" TEXT;

-- AlterTable
ALTER TABLE "University" ADD COLUMN     "city" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "state" TEXT,
ADD COLUMN     "status" "UniversityStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "UniversitySettings" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "utilizationConfig" JSONB,
    "activityLoggingPolicy" JSONB,
    "defaultBreakPolicy" JSONB,
    "activityRetentionDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UniversitySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "departmentId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicTerm" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "TermStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "departmentId" TEXT,
    "programId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "credits" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseAssignment" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "academicTermId" TEXT,
    "role" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "academicTermId" TEXT,
    "name" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleSlot" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "instructorId" TEXT NOT NULL,
    "courseId" TEXT,
    "activityTypeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "status" "ScheduleSlotStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakPolicy" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BreakPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkloadTarget" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "instructorId" TEXT,
    "activityTypeId" TEXT,
    "targetMinutes" INTEGER NOT NULL,
    "periodType" "ReportingPeriodType" NOT NULL DEFAULT 'WEEKLY',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkloadTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportingPeriod" (
    "id" TEXT NOT NULL,
    "universityId" TEXT,
    "type" "ReportingPeriodType" NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorDailyMetric" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "metricDate" DATE NOT NULL,
    "capacityMinutes" INTEGER NOT NULL DEFAULT 0,
    "productiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "unutilizedMinutes" INTEGER NOT NULL DEFAULT 0,
    "missingDataMinutes" INTEGER NOT NULL DEFAULT 0,
    "overlapMinutes" INTEGER NOT NULL DEFAULT 0,
    "minutesByActivityType" JSONB NOT NULL DEFAULT '{}',
    "isWorkingDay" BOOLEAN NOT NULL DEFAULT true,
    "nonWorkingReason" TEXT,
    "openingLogged" BOOLEAN NOT NULL DEFAULT false,
    "closingLogged" BOOLEAN NOT NULL DEFAULT false,
    "utilizationPercent" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructorDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorWeeklyMetric" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "capacityMinutes" INTEGER NOT NULL DEFAULT 0,
    "productiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "unutilizedMinutes" INTEGER NOT NULL DEFAULT 0,
    "missingDataMinutes" INTEGER NOT NULL DEFAULT 0,
    "minutesByActivityType" JSONB NOT NULL DEFAULT '{}',
    "utilizationPercent" DOUBLE PRECISION,
    "openingCompliancePct" DOUBLE PRECISION,
    "closingCompliancePct" DOUBLE PRECISION,
    "expectedWorkingDays" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructorWeeklyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniversityDailyMetric" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "metricDate" DATE NOT NULL,
    "activeInstructors" INTEGER NOT NULL DEFAULT 0,
    "capacityMinutes" INTEGER NOT NULL DEFAULT 0,
    "productiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "unutilizedMinutes" INTEGER NOT NULL DEFAULT 0,
    "missingDataMinutes" INTEGER NOT NULL DEFAULT 0,
    "minutesByActivityType" JSONB NOT NULL DEFAULT '{}',
    "utilizationPercent" DOUBLE PRECISION,
    "openingCompliancePct" DOUBLE PRECISION,
    "closingCompliancePct" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UniversityDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportJob" (
    "id" TEXT NOT NULL,
    "universityId" TEXT,
    "requestedById" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'CSV',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "status" "ReportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "resultUrl" TEXT,
    "errorMessage" TEXT,
    "rowCount" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UniversitySettings_universityId_key" ON "UniversitySettings"("universityId");

-- CreateIndex
CREATE INDEX "Department_universityId_idx" ON "Department"("universityId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_universityId_code_key" ON "Department"("universityId", "code");

-- CreateIndex
CREATE INDEX "Program_universityId_idx" ON "Program"("universityId");

-- CreateIndex
CREATE UNIQUE INDEX "Program_universityId_code_key" ON "Program"("universityId", "code");

-- CreateIndex
CREATE INDEX "AcademicTerm_universityId_startDate_endDate_idx" ON "AcademicTerm"("universityId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicTerm_universityId_name_key" ON "AcademicTerm"("universityId", "name");

-- CreateIndex
CREATE INDEX "Course_universityId_idx" ON "Course"("universityId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_universityId_code_key" ON "Course"("universityId", "code");

-- CreateIndex
CREATE INDEX "CourseAssignment_universityId_instructorId_idx" ON "CourseAssignment"("universityId", "instructorId");

-- CreateIndex
CREATE INDEX "CourseAssignment_universityId_courseId_idx" ON "CourseAssignment"("universityId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAssignment_courseId_instructorId_academicTermId_key" ON "CourseAssignment"("courseId", "instructorId", "academicTermId");

-- CreateIndex
CREATE INDEX "Schedule_universityId_instructorId_idx" ON "Schedule"("universityId", "instructorId");

-- CreateIndex
CREATE INDEX "ScheduleSlot_universityId_workDate_idx" ON "ScheduleSlot"("universityId", "workDate");

-- CreateIndex
CREATE INDEX "ScheduleSlot_instructorId_workDate_idx" ON "ScheduleSlot"("instructorId", "workDate");

-- CreateIndex
CREATE INDEX "ScheduleSlot_universityId_instructorId_workDate_idx" ON "ScheduleSlot"("universityId", "instructorId", "workDate");

-- CreateIndex
CREATE INDEX "BreakPolicy_universityId_isActive_idx" ON "BreakPolicy"("universityId", "isActive");

-- CreateIndex
CREATE INDEX "WorkloadTarget_universityId_activityTypeId_effectiveFrom_idx" ON "WorkloadTarget"("universityId", "activityTypeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "WorkloadTarget_instructorId_effectiveFrom_idx" ON "WorkloadTarget"("instructorId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ReportingPeriod_universityId_startDate_idx" ON "ReportingPeriod"("universityId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReportingPeriod_universityId_type_startDate_endDate_key" ON "ReportingPeriod"("universityId", "type", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "InstructorDailyMetric_universityId_metricDate_idx" ON "InstructorDailyMetric"("universityId", "metricDate");

-- CreateIndex
CREATE INDEX "InstructorDailyMetric_universityId_instructorId_metricDate_idx" ON "InstructorDailyMetric"("universityId", "instructorId", "metricDate");

-- CreateIndex
CREATE UNIQUE INDEX "InstructorDailyMetric_instructorId_metricDate_key" ON "InstructorDailyMetric"("instructorId", "metricDate");

-- CreateIndex
CREATE INDEX "InstructorWeeklyMetric_universityId_periodStart_idx" ON "InstructorWeeklyMetric"("universityId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "InstructorWeeklyMetric_instructorId_periodStart_key" ON "InstructorWeeklyMetric"("instructorId", "periodStart");

-- CreateIndex
CREATE INDEX "UniversityDailyMetric_metricDate_idx" ON "UniversityDailyMetric"("metricDate");

-- CreateIndex
CREATE UNIQUE INDEX "UniversityDailyMetric_universityId_metricDate_key" ON "UniversityDailyMetric"("universityId", "metricDate");

-- CreateIndex
CREATE INDEX "ReportJob_universityId_createdAt_idx" ON "ReportJob"("universityId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportJob_status_createdAt_idx" ON "ReportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_universityId_workDate_idx" ON "ActivityLog"("universityId", "workDate");

-- CreateIndex
CREATE INDEX "ActivityLog_universityId_instructorId_workDate_idx" ON "ActivityLog"("universityId", "instructorId", "workDate");

-- CreateIndex
CREATE INDEX "ActivityLog_scheduleSlotId_idx" ON "ActivityLog"("scheduleSlotId");

-- CreateIndex
CREATE INDEX "ActivityLog_deliverableId_idx" ON "ActivityLog"("deliverableId");

-- CreateIndex
CREATE INDEX "AiInsight_universityId_createdAt_idx" ON "AiInsight"("universityId", "createdAt");

-- CreateIndex
CREATE INDEX "AiInsight_instructorId_createdAt_idx" ON "AiInsight"("instructorId", "createdAt");

-- CreateIndex
CREATE INDEX "AiInsight_scope_status_idx" ON "AiInsight"("scope", "status");

-- CreateIndex
CREATE INDEX "AuditLog_universityId_createdAt_idx" ON "AuditLog"("universityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Deliverable_universityId_status_idx" ON "Deliverable"("universityId", "status");

-- CreateIndex
CREATE INDEX "Deliverable_instructorId_status_idx" ON "Deliverable"("instructorId", "status");

-- CreateIndex
CREATE INDEX "Deliverable_universityId_dueDate_idx" ON "Deliverable"("universityId", "dueDate");

-- CreateIndex
CREATE INDEX "DeliverableLog_deliverableId_workDate_idx" ON "DeliverableLog"("deliverableId", "workDate");

-- CreateIndex
CREATE INDEX "DeliverableLog_universityId_instructorId_workDate_idx" ON "DeliverableLog"("universityId", "instructorId", "workDate");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "University_code_key" ON "University"("code");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_scheduleSlotId_fkey" FOREIGN KEY ("scheduleSlotId") REFERENCES "ScheduleSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableLog" ADD CONSTRAINT "DeliverableLog_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverableLog" ADD CONSTRAINT "DeliverableLog_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInsight" ADD CONSTRAINT "AiInsight_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInsight" ADD CONSTRAINT "AiInsight_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniversitySettings" ADD CONSTRAINT "UniversitySettings_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssignment" ADD CONSTRAINT "CourseAssignment_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssignment" ADD CONSTRAINT "CourseAssignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssignment" ADD CONSTRAINT "CourseAssignment_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssignment" ADD CONSTRAINT "CourseAssignment_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakPolicy" ADD CONSTRAINT "BreakPolicy_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkloadTarget" ADD CONSTRAINT "WorkloadTarget_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkloadTarget" ADD CONSTRAINT "WorkloadTarget_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkloadTarget" ADD CONSTRAINT "WorkloadTarget_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingPeriod" ADD CONSTRAINT "ReportingPeriod_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorDailyMetric" ADD CONSTRAINT "InstructorDailyMetric_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorDailyMetric" ADD CONSTRAINT "InstructorDailyMetric_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorWeeklyMetric" ADD CONSTRAINT "InstructorWeeklyMetric_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorWeeklyMetric" ADD CONSTRAINT "InstructorWeeklyMetric_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniversityDailyMetric" ADD CONSTRAINT "UniversityDailyMetric_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportJob" ADD CONSTRAINT "ReportJob_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportJob" ADD CONSTRAINT "ReportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════
-- BACKFILL — before the NOT NULL constraints below are enforced.
-- ═══════════════════════════════════════════════════════════════════════

-- University.code: stable UNIV### assigned by creation order.
WITH numbered AS (
  SELECT id, 'UNIV' || LPAD(ROW_NUMBER() OVER (ORDER BY "createdAt", id)::text, 3, '0') AS code
  FROM "University"
)
UPDATE "University" u SET "code" = n.code FROM numbered n WHERE u.id = n.id;
ALTER TABLE "University" ALTER COLUMN "code" SET NOT NULL;

-- Deliverable.status: carry the old ActivityStatus meaning across, then swap.
UPDATE "Deliverable" SET "status_new" =
  CASE "status"::text
    WHEN 'COMPLETED' THEN 'COMPLETED'::"DeliverableStatus"
    WHEN 'MISSED'    THEN 'OVERDUE'::"DeliverableStatus"
    ELSE 'NOT_STARTED'::"DeliverableStatus"
  END;
ALTER TABLE "Deliverable" DROP COLUMN "status";
ALTER TABLE "Deliverable" RENAME COLUMN "status_new" TO "status";

-- AiInsight: existing rows have free-text `period` but no structured bounds.
-- Parse where the text is a real date range; otherwise fall back to the row's
-- own creation date rather than inventing a period.
UPDATE "AiInsight" SET
  "title"         = COALESCE("title", "type"),
  "summary"       = COALESCE("summary", "recommendation"),
  "sourceMetrics" = COALESCE("sourceMetrics", "supportingData"),
  "periodStart"   = COALESCE("periodStart",
                      CASE WHEN "period" ~ '^\d{4}-\d{2}-\d{2}'
                           THEN LEFT("period", 10)::date ELSE "createdAt"::date END),
  "periodEnd"     = COALESCE("periodEnd",
                      CASE WHEN "period" ~ '\d{4}-\d{2}-\d{2}$'
                           THEN RIGHT("period", 10)::date ELSE "createdAt"::date END);

ALTER TABLE "AiInsight"
  ALTER COLUMN "title" SET NOT NULL,
  ALTER COLUMN "summary" SET NOT NULL,
  ALTER COLUMN "sourceMetrics" SET NOT NULL,
  ALTER COLUMN "periodStart" SET NOT NULL,
  ALTER COLUMN "periodEnd" SET NOT NULL;

-- DeliverableLog: derive the tenant path from the parent deliverable.
UPDATE "DeliverableLog" dl
SET "universityId" = d."universityId", "instructorId" = d."instructorId"
FROM "Deliverable" d WHERE dl."deliverableId" = d.id;
DELETE FROM "DeliverableLog" WHERE "universityId" IS NULL OR "instructorId" IS NULL;
ALTER TABLE "DeliverableLog"
  ALTER COLUMN "universityId" SET NOT NULL,
  ALTER COLUMN "instructorId" SET NOT NULL;

-- Notification.readAt: preserve the meaning of the existing boolean.
UPDATE "Notification" SET "readAt" = "createdAt" WHERE "isRead" = true AND "readAt" IS NULL;

-- One settings row per existing university.
INSERT INTO "UniversitySettings" (id, "universityId", "createdAt", "updatedAt")
SELECT 'us_' || id, id, now(), now() FROM "University"
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- DATA INTEGRITY (§49) — in the database, not only in services.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "ScheduleSlot"
  ADD CONSTRAINT "schedule_slot_positive_interval" CHECK ("endTime" > "startTime");

ALTER TABLE "DeliverableLog"
  ADD CONSTRAINT "deliverable_log_non_negative"
  CHECK ("quantityCompleted" >= 0 AND "hoursSpent" >= 0);

ALTER TABLE "Deliverable"
  ADD CONSTRAINT "deliverable_non_negative_targets"
  CHECK ("targetQuantity" >= 0 AND "targetHours" >= 0);

ALTER TABLE "WorkloadTarget"
  ADD CONSTRAINT "workload_target_positive" CHECK ("targetMinutes" > 0);
ALTER TABLE "WorkloadTarget"
  ADD CONSTRAINT "workload_target_valid_range"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

ALTER TABLE "AcademicTerm"
  ADD CONSTRAINT "academic_term_valid_range" CHECK ("endDate" >= "startDate");
ALTER TABLE "ReportingPeriod"
  ADD CONSTRAINT "reporting_period_valid_range" CHECK ("endDate" >= "startDate");

ALTER TABLE "BreakPolicy"
  ADD CONSTRAINT "break_policy_valid_window"
  CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute");

ALTER TABLE "InstructorDailyMetric"
  ADD CONSTRAINT "instructor_daily_metric_sane"
  CHECK ("capacityMinutes" >= 0 AND "productiveMinutes" >= 0
         AND "unutilizedMinutes" >= 0 AND "missingDataMinutes" >= 0);

ALTER TABLE "UniversityDailyMetric"
  ADD CONSTRAINT "university_daily_metric_sane"
  CHECK ("capacityMinutes" >= 0 AND "productiveMinutes" >= 0
         AND "unutilizedMinutes" >= 0 AND "missingDataMinutes" >= 0);

-- An insight's scope must agree with which subject column is populated (§27),
-- so a PLATFORM insight can never quietly carry a tenant id and vice versa.
ALTER TABLE "AiInsight"
  ADD CONSTRAINT "ai_insight_scope_subject"
  CHECK (
    ("scope" = 'PLATFORM'   AND "universityId" IS NULL)
    OR ("scope" = 'UNIVERSITY' AND "universityId" IS NOT NULL)
    OR ("scope" = 'MANAGER'    AND "managerId"    IS NOT NULL)
    OR ("scope" = 'INSTRUCTOR' AND "instructorId" IS NOT NULL)
  );
