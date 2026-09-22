CREATE TABLE "IndexGeneration" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "leaseToken" TEXT NOT NULL,
  "legacy" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "cleanedAt" TIMESTAMP(3),
  "cleanupToken" TEXT,
  "cleanupLeaseExpiresAt" TIMESTAMP(3),
  CONSTRAINT "IndexGeneration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IndexGeneration_cleanedAt_retiredAt_idx" ON "IndexGeneration"("cleanedAt", "retiredAt");
CREATE INDEX "IndexGeneration_cleanedAt_createdAt_idx" ON "IndexGeneration"("cleanedAt", "createdAt");
CREATE INDEX "IndexGeneration_agentId_idx" ON "IndexGeneration"("agentId");
