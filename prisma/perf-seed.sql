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

TRUNCATE "ActivityLog", "LeaveRequest", "DeliverableLog", "Deliverable",
         "AiInsight", "AuditLog", "Notification", "Session",
         "Instructor", "Manager", "UniversityWorkingHours", "UniversityHoliday",
         "User", "University", "ActivityType" RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------- activity types
INSERT INTO "ActivityType" (id, code, label, "sortOrder", "isSystem",
                            "isOncePerDay", "isDerivedFromWorkingHours",
                            "countsAsProductive", "isUnutilized",
                            "createdAt", "updatedAt")
VALUES
  ('at_open',  'DAILY_OPENING',   'Daily Opening',   10,  true, true,  true,  true,  false, now(), now()),
  ('at_teach', 'TEACHING',        'Teaching',        20,  true, false, false, true,  false, now(), now()),
  ('at_learn', 'LEARNING',        'Learning',        30,  true, false, false, true,  false, now(), now()),
  ('at_supp',  'STUDENT_SUPPORT', 'Student Support', 40,  true, false, false, true,  false, now(), now()),
  ('at_admin', 'ADMINISTRATIVE',  'Administrative',  50,  true, false, false, true,  false, now(), now()),
  ('at_meet',  'MEETING',         'Meeting',         60,  true, false, false, true,  false, now(), now()),
  ('at_deliv', 'DELIVERABLE',     'Deliverable Work',70,  true, false, false, true,  false, now(), now()),
  ('at_res',   'RESEARCH',        'Research',        80,  true, false, false, true,  false, now(), now()),
  ('at_other', 'OTHER',           'Other',           90,  true, false, false, true,  false, now(), now()),
  ('at_close', 'DAILY_CLOSING',   'Daily Closing',   100, true, true,  true,  true,  false, now(), now()),
  ('at_unutil','UNUTILIZED',      'Unutilized Time', 110, true, false, false, false, true,  now(), now());

-- ---------------------------------------------------------------- universities
INSERT INTO "University" (id, name, slug, timezone, "openingDurationMin",
                          "closingDurationMin", "breakDurationMin",
                          "createdAt", "updatedAt")
SELECT
  'uni_' || u,
  'University ' || u,
  'uni-' || u,
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

INSERT INTO "ActivityLog" (id, "instructorId", "universityId", "activityTypeId",
                           "workDate", "startTime", "endTime", status,
                           "isOncePerDay", "createdAt", "updatedAt")
SELECT
  'al_' || u || '_' || i || '_' || d || '_' || s,
  'ins_' || u || '_' || i,
  'uni_' || u,
  (ARRAY['at_teach','at_learn','at_supp','at_admin','at_meet','at_deliv'])[s],
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
