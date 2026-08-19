-- Which subject an entry falls under, as read from the instructor's own
-- sentence. Nullable: a staff meeting has no subject, and guessing one would
-- invent the column the client's report is grouped by.
ALTER TABLE "ActivityLog" ADD COLUMN "broadCategoryId" TEXT;

ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_broadCategoryId_fkey"
    FOREIGN KEY ("broadCategoryId") REFERENCES "InstructorCategory"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ActivityLog_broadCategoryId_idx" ON "ActivityLog"("broadCategoryId");
