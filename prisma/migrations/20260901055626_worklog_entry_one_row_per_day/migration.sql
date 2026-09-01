-- One row per instructor per day, and the archive of what is being dropped.
--
-- Structural first, then the data move, then a reconciliation that ABORTS rather
-- than correcting. Every statement runs in one transaction: Prisma wraps a
-- migration file, so a failed assertion below rolls the whole thing back and
-- leaves the old shape untouched.
--
-- Nothing is dropped here. `ActivityLog` and the taxonomy tables are still read
-- by the application and are removed in a later migration once nothing does —
-- dropping them now would leave the tree un-buildable between commits.

-- CreateEnum
CREATE TYPE "WorklogEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED');

-- CreateTable
CREATE TABLE "WorklogEntry" (
    "id" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "logDate" DATE NOT NULL,
    "activities" JSONB NOT NULL DEFAULT '[]',
    "totalHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "status" "WorklogEntryStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorklogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorklogActivityArchive" (
    "id" TEXT NOT NULL,
    "activityLogId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "activityTypeCode" TEXT,
    "activityTypeLabel" TEXT,
    "deliverableCode" TEXT,
    "deliverableLabel" TEXT,
    "broadCategoryCode" TEXT,
    "broadCategoryLabel" TEXT,
    "quantity" INTEGER,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorklogActivityArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorklogEntry_universityId_logDate_idx" ON "WorklogEntry"("universityId", "logDate");

-- CreateIndex
CREATE UNIQUE INDEX "WorklogEntry_instructorId_logDate_key" ON "WorklogEntry"("instructorId", "logDate");

-- CreateIndex
CREATE UNIQUE INDEX "WorklogActivityArchive_activityLogId_key" ON "WorklogActivityArchive"("activityLogId");

-- CreateIndex
CREATE INDEX "WorklogActivityArchive_instructorId_workDate_idx" ON "WorklogActivityArchive"("instructorId", "workDate");

-- AddForeignKey
ALTER TABLE "WorklogEntry" ADD CONSTRAINT "WorklogEntry_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorklogEntry" ADD CONSTRAINT "WorklogEntry_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── 1. Archive the values being dropped ──────────────────────────────────────
-- Keyed by the row they came from, and deliberately NOT a foreign key: the row
-- it names is dropped later, and an archive that cascades with its source is not
-- an archive.
INSERT INTO "WorklogActivityArchive" (
  "id", "activityLogId", "instructorId", "workDate",
  "activityTypeCode", "activityTypeLabel",
  "deliverableCode", "deliverableLabel",
  "broadCategoryCode", "broadCategoryLabel",
  "quantity", "archivedAt"
)
SELECT
  md5(random()::text || a."id"),
  a."id",
  a."instructorId",
  a."workDate",
  t."code",  t."label",
  d."code",  d."label",
  b."code",  b."label",
  a."quantity",
  now()
FROM "ActivityLog" a
LEFT JOIN "ActivityType"    t ON t."id" = a."activityTypeId"
LEFT JOIN "DeliverableType" d ON d."id" = a."deliverableTypeId"
-- Broad Category is an `InstructorCategory`, not a table of its own.
LEFT JOIN "InstructorCategory" b ON b."id" = a."broadCategoryId";

-- Every activity must be archived. A mismatch means the join dropped rows.
DO $$
DECLARE archived bigint; source bigint;
BEGIN
  SELECT count(*) INTO archived FROM "WorklogActivityArchive";
  SELECT count(*) INTO source   FROM "ActivityLog";
  IF archived <> source THEN
    RAISE EXCEPTION 'Archive incomplete: % archived against % activity rows', archived, source;
  END IF;
END $$;

-- ── 2. Group into one row per instructor-day ─────────────────────────────────
-- Each old row becomes one item in `activities`; its raw text becomes the label.
-- `rawText` is what the instructor typed and is the description now; where a row
-- never captured it, the deliverable's own name is the only record of that line
-- and stands in.
--
-- Hours come from the clock range, which is where duration has always been
-- measured. NULL hours stay NULL: an unrecorded duration and a zero one are
-- different facts, and `0` here would be inventing the second.
INSERT INTO "WorklogEntry" (
  "id", "instructorId", "universityId", "logDate",
  "activities", "totalHours", "remarks", "status",
  "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || a."instructorId" || a."workDate"::text),
  a."instructorId",
  min(a."universityId"),
  a."workDate",
  jsonb_agg(
    jsonb_build_object(
      'label',    coalesce(nullif(btrim(a."rawText"), ''), d."label", t."label"),
      'quantity', a."quantity",
      'hours',    round(extract(epoch FROM (a."endTime" - a."startTime")) / 3600.0, 2)
    )
    ORDER BY a."startTime", a."id"
  ),
  round(sum(extract(epoch FROM (a."endTime" - a."startTime")) / 3600.0), 2),
  -- One note for the day. The old shape carried a remark per activity, so the
  -- distinct ones are joined rather than one of them being picked arbitrarily.
  nullif(string_agg(DISTINCT nullif(btrim(a."remarks"), ''), ' | '), ''),
  'SUBMITTED',
  min(a."createdAt"),
  now()
FROM "ActivityLog" a
LEFT JOIN "ActivityType"    t ON t."id" = a."activityTypeId"
LEFT JOIN "DeliverableType" d ON d."id" = a."deliverableTypeId"
GROUP BY a."instructorId", a."workDate";

-- ── 3. Reconcile, and ABORT on any mismatch ──────────────────────────────────
-- Not a warning and not a repair. A silent correction here would be this
-- migration deciding what somebody's recorded hours were.
DO $$
DECLARE bad_hours bigint; bad_counts bigint; bad_days bigint;
BEGIN
  -- Hours per day must match the source to the cent.
  SELECT count(*) INTO bad_hours
  FROM (
    SELECT a."instructorId", a."workDate",
           round(sum(extract(epoch FROM (a."endTime" - a."startTime")) / 3600.0), 2) AS old_hours
    FROM "ActivityLog" a GROUP BY 1, 2
  ) src
  JOIN "WorklogEntry" e
    ON e."instructorId" = src."instructorId" AND e."logDate" = src."workDate"
  WHERE abs(e."totalHours" - src.old_hours) > 0.01;

  IF bad_hours > 0 THEN
    RAISE EXCEPTION 'Hours do not reconcile on % instructor-days', bad_hours;
  END IF;

  -- One activity item per old row.
  SELECT count(*) INTO bad_counts
  FROM (
    SELECT a."instructorId", a."workDate", count(*) AS old_rows
    FROM "ActivityLog" a GROUP BY 1, 2
  ) src
  JOIN "WorklogEntry" e
    ON e."instructorId" = src."instructorId" AND e."logDate" = src."workDate"
  WHERE jsonb_array_length(e."activities") <> src.old_rows;

  IF bad_counts > 0 THEN
    RAISE EXCEPTION 'Activity counts do not reconcile on % instructor-days', bad_counts;
  END IF;

  -- Every distinct instructor-day became exactly one row.
  SELECT count(*) INTO bad_days FROM (
    SELECT DISTINCT "instructorId", "workDate" FROM "ActivityLog"
  ) src
  LEFT JOIN "WorklogEntry" e
    ON e."instructorId" = src."instructorId" AND e."logDate" = src."workDate"
  WHERE e."id" IS NULL;

  IF bad_days > 0 THEN
    RAISE EXCEPTION '% instructor-days did not migrate', bad_days;
  END IF;
END $$;
