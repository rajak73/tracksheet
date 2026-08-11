-- Backstop for the service-layer validation in activities/logger.ts. A negative
-- or zero-length activity corrupts every hour aggregate that reads this table,
-- so the database refuses to store one regardless of which code path writes it.
ALTER TABLE "ActivityLog"
  ADD CONSTRAINT "activity_log_positive_interval"
  CHECK ("endTime" > "startTime");

-- Approved leave ranges must be well-formed for capacity subtraction to work.
ALTER TABLE "LeaveRequest"
  ADD CONSTRAINT "leave_request_valid_range"
  CHECK ("endDate" >= "startDate");
