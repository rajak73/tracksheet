-- Follow-up to phase10.
--
-- The two status indexes were emitted by the generator BEFORE the hand-written
-- `status_new` -> `status` rename in that migration, so they referenced a column
-- that did not yet exist under that name and were dropped from the script. They
-- are created here rather than by editing the applied migration, which would
-- invalidate its checksum.
CREATE INDEX "Deliverable_universityId_status_idx" ON "Deliverable"("universityId", "status");
CREATE INDEX "Deliverable_instructorId_status_idx" ON "Deliverable"("instructorId", "status");
