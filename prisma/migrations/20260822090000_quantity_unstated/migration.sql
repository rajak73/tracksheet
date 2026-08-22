-- "The instructor did not say how many" needs somewhere to live.
--
-- Additive: every existing row keeps the number it has, and the default stays 1
-- so nothing that writes without naming the column changes behaviour. Only the
-- worklog parsers write NULL, and only for deliverables whose unit counts items
-- rather than occurrences — where the client's rule forbids defaulting to 1.
ALTER TABLE "ActivityLog" ALTER COLUMN "quantity" DROP NOT NULL;
