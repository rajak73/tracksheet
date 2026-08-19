-- What an instructor teaches, as the client's monthly sheet reports it.
-- Additive: a table nobody references yet, and a nullable column on Instructor,
-- so every existing row keeps its current meaning ("not categorised yet").
CREATE TABLE "InstructorCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstructorCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstructorCategory_code_key" ON "InstructorCategory"("code");
CREATE INDEX "InstructorCategory_sortOrder_idx" ON "InstructorCategory"("sortOrder");

ALTER TABLE "Instructor" ADD COLUMN "categoryId" TEXT;

ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "InstructorCategory"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
