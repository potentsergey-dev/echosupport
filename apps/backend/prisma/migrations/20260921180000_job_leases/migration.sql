ALTER TABLE "Job"
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Job_status_leaseExpiresAt_idx" ON "Job"("status", "leaseExpiresAt");
