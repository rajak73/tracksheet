-- Performance dataset generator.
--
-- Builds a realistic-shaped tenant population so query plans can be measured
-- rather than guessed at. Uses generate_series rather than the ORM because the
-- point is volume, not application semantics.
--
-- Defaults: 100 universities x 100 instructors x 90 days x ~6 activities/day.
-- Adjust the three constants in the `params` CTE below to change the scale.

\set ON_ERROR_STOP on

BEGIN;

TRUNCATE "ActivityLog_deprecated", "LeaveRequest", "DeliverableLog", "Deliverable",
         "AiInsight", "AuditLog", "Notification", "Session",
         "Instructor", "Manager", "UniversityWorkingHours", "UniversityHoliday",
         "User", "University" RESTART IDENTITY CASCADE;

-- The activity-type seed is gone with the table. It provisioned eleven work
-- types — TEACHING, MENTORING, ADMINISTRATIVE — which is the fixed taxonomy
-- this product does not have anywhere, including in a performance fixture.

-- ---------------------------------------------------------------- universities
-- `code` is NOT NULL and unique. It was added after this file was written, so
-- the seed failed on the constraint and the perf database could not be built at
-- all — which is worse than it sounds: it is the only place query plans get
-- measured rather than guessed at.
INSERT INTO "University" (id, name, slug, code, timezone, "openingDurationMin",
                          "closingDurationMin", "breakDurationMin",
                          "createdAt", "updatedAt")
SELECT
  'uni_' || u,
  'University ' || u,
  'uni-' || u,
  'UNI' || lpad(u::text, 4, '0'),
  (ARRAY['Asia/Kolkata','America/New_York','Europe/London','Australia/Sydney'])[1 + (u % 4)],
  15, 15, 60, now(), now()
FROM generate_series(1, 100) AS u;

INSERT INTO "UniversityWorkingHours" (id, "universityId", "dayOfWeek", "isWorkingDay",
                                      "startMinute", "endMinute")
SELECT 'wh_' || u || '_' || d, 'uni_' || u, d,
       d BETWEEN 1 AND 5,
       CASE WHEN d BETWEEN 1 AND 5 THEN 540 ELSE 0 END,
       CASE WHEN d BETWEEN 1 AND 5 THEN 1080 ELSE 1 END
FROM generate_series(1, 100) AS u, generate_series(0, 6) AS d;

-- ---------------------------------------------------------------- users
INSERT INTO "User" (id, email, "passwordHash", name, role, "isActive",
                    "universityId", "createdAt", "updatedAt")
SELECT 'umgr_' || u, 'manager' || u || '@perf.test', 'x', 'Manager ' || u,
       'MANAGER', true, 'uni_' || u, now(), now()
FROM generate_series(1, 100) AS u;

INSERT INTO "User" (id, email, "passwordHash", name, role, "isActive",
                    "universityId", "createdAt", "updatedAt")
SELECT 'uins_' || u || '_' || i, 'inst' || u || '_' || i || '@perf.test', 'x',
       'Instructor ' || u || '-' || i, 'INSTRUCTOR', true, 'uni_' || u, now(), now()
FROM generate_series(1, 100) AS u, generate_series(1, 100) AS i;

INSERT INTO "Manager" (id, "userId", "universityId", "employeeCode", "createdAt", "updatedAt")
SELECT 'mgr_' || u, 'umgr_' || u, 'uni_' || u, 'MGR-' || u, now(), now()
FROM generate_series(1, 100) AS u;

INSERT INTO "Instructor" (id, "userId", "universityId", "employeeCode", "createdAt", "updatedAt")
SELECT 'ins_' || u || '_' || i, 'uins_' || u || '_' || i, 'uni_' || u,
       'EMP-' || u || '-' || i, now(), now()
FROM generate_series(1, 100) AS u, generate_series(1, 100) AS i;

COMMIT;

-- ---------------------------------------------------------------- activity logs
-- 90 days x 6 activities per instructor per weekday.
-- Committed separately so the bulk insert does not hold the earlier locks.
BEGIN;

INSERT INTO "ActivityLog_deprecated" (id, "instructorId", "universityId",
                           "workDate", "startTime", "endTime", status,
                           "isOncePerDay", "createdAt", "updatedAt")
SELECT
  'al_' || u || '_' || i || '_' || d || '_' || s,
  'ins_' || u || '_' || i,
  'uni_' || u,
  (DATE '2026-05-04' + d)::date,
  (DATE '2026-05-04' + d)::timestamp + ((8 + s) * INTERVAL '1 hour'),
  (DATE '2026-05-04' + d)::timestamp + ((9 + s) * INTERVAL '1 hour'),
  'COMPLETED',
  false,
  now(), now()
FROM generate_series(1, 100) AS u,
     generate_series(1, 100) AS i,
     generate_series(0, 89) AS d,
     generate_series(1, 6) AS s
WHERE EXTRACT(DOW FROM (DATE '2026-05-04' + d)) BETWEEN 1 AND 5;

COMMIT;

ANALYZE;
