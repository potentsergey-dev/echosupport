ALTER TABLE "Job" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");
