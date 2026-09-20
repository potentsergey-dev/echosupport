ALTER TABLE "Document" ADD COLUMN "storageVersion" TEXT;

CREATE TYPE "UploadIntentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'EXPIRED');

CREATE TABLE "UploadIntent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL CHECK ("sizeBytes" > 0),
    "stagingKey" TEXT NOT NULL,
    "finalKey" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "finalVersion" TEXT,
    "status" "UploadIntentStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "cleanupToken" TEXT,
    "cleanupExpiresAt" TIMESTAMP(3),
    "cleanupAfter" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UploadIntent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UploadIntent_processing_lease" CHECK (
      "status" <> 'PROCESSING' OR ("leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    ),
    CONSTRAINT "UploadIntent_completed_version" CHECK (
      "status" <> 'COMPLETED' OR (
        "sourceVersion" IS NOT NULL AND "finalVersion" IS NOT NULL AND "completedAt" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "UploadIntent_documentId_key" ON "UploadIntent"("documentId");
CREATE UNIQUE INDEX "UploadIntent_stagingKey_key" ON "UploadIntent"("stagingKey");
CREATE UNIQUE INDEX "UploadIntent_finalKey_key" ON "UploadIntent"("finalKey");
CREATE UNIQUE INDEX "UploadIntent_tenantId_idempotencyKey_key" ON "UploadIntent"("tenantId", "idempotencyKey");
CREATE INDEX "UploadIntent_status_expiresAt_idx" ON "UploadIntent"("status", "expiresAt");
CREATE INDEX "UploadIntent_cleanupAfter_idx" ON "UploadIntent"("cleanupAfter");
CREATE INDEX "UploadIntent_agentId_idx" ON "UploadIntent"("agentId");
