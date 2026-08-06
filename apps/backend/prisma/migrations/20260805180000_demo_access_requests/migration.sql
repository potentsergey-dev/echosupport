-- Controlled access to a shared public demo. Demo viewers can be granted a
-- short-lived account without exposing owner credentials.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DEMO_VIEWER';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessExpiresAt" TIMESTAMP(3);

CREATE TYPE "DemoAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');

CREATE TABLE "DemoAccessRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "purpose" TEXT NOT NULL,
    "status" "DemoAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,
    "accessUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoAccessRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DemoAccessRequest_status_createdAt_idx" ON "DemoAccessRequest"("status", "createdAt");
CREATE INDEX "DemoAccessRequest_email_createdAt_idx" ON "DemoAccessRequest"("email", "createdAt");
