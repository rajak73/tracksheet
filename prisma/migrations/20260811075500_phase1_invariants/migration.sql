-- Phase 0 §3.8: an ADMIN is global and must have no tenant binding; a MANAGER or
-- INSTRUCTOR must always have one. Enforced in the database so no service-layer
-- bug can create an unscoped tenant user (which would leak across universities)
-- or a tenant-bound admin (which would silently break global queries).
ALTER TABLE "User"
  ADD CONSTRAINT "user_role_tenant_binding"
  CHECK (
    ("role" = 'ADMIN'  AND "universityId" IS NULL)
    OR
    ("role" <> 'ADMIN' AND "universityId" IS NOT NULL)
  );

-- Working-hours sanity: a window must be well-formed and inside a single day.
ALTER TABLE "UniversityWorkingHours"
  ADD CONSTRAINT "working_hours_valid_window"
  CHECK (
    "dayOfWeek" BETWEEN 0 AND 6
    AND "startMinute" >= 0
    AND "endMinute" <= 1440
    AND "startMinute" < "endMinute"
  );

-- Opening/closing durations must be positive and must fit inside a working day.
ALTER TABLE "University"
  ADD CONSTRAINT "university_activity_durations_positive"
  CHECK ("openingDurationMin" > 0 AND "closingDurationMin" > 0);
