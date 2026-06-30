-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'WAITING_OPERATOR', 'WITH_OPERATOR', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageAuthorType" AS ENUM ('VISITOR', 'AGENT', 'OPERATOR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('HANDOFF_REQUESTED', 'NEW_APPOINTMENT', 'NEW_VISITOR_MESSAGE', 'OPERATOR_MENTION');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'OPERATOR';

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxMessageLength" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN     "maxMessagesPerHourPerVisitor" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "maxSessionsPerDayPerVisitor" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "attachments" JSONB,
ADD COLUMN     "authorId" TEXT,
ADD COLUMN     "authorType" "MessageAuthorType" NOT NULL DEFAULT 'AGENT',
ADD COLUMN     "isInternal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "assignedOperatorId" TEXT,
ADD COLUMN     "csatComment" TEXT,
ADD COLUMN     "csatRating" INTEGER,
ADD COLUMN     "handoffReason" TEXT,
ADD COLUMN     "handoffRequestedAt" TIMESTAMP(3),
ADD COLUMN     "internalNote" TEXT,
ADD COLUMN     "pageReferrer" TEXT,
ADD COLUMN     "pageUrl" TEXT,
ADD COLUMN     "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "unreadByOperator" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unreadByVisitor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visitorContact" TEXT,
ADD COLUMN     "visitorName" TEXT;

-- CreateTable
CREATE TABLE "BusinessHours" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Minsk',
    "schedule" JSONB NOT NULL,
    "holidays" JSONB,
    "outOfHoursMessage" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BusinessHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorRateLimit" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visitorKey" TEXT NOT NULL,
    "sessionsToday" INTEGER NOT NULL DEFAULT 0,
    "messagesHour" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorRateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorNotification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "channels" TEXT[],
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "OperatorNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CannedResponse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT,
    "shortcut" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CannedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHours_agentId_key" ON "BusinessHours"("agentId");

-- CreateIndex
CREATE INDEX "VisitorRateLimit_blockedUntil_idx" ON "VisitorRateLimit"("blockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorRateLimit_agentId_visitorKey_key" ON "VisitorRateLimit"("agentId", "visitorKey");

-- CreateIndex
CREATE INDEX "OperatorNotification_status_createdAt_idx" ON "OperatorNotification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OperatorNotification_tenantId_idx" ON "OperatorNotification"("tenantId");

-- CreateIndex
CREATE INDEX "CannedResponse_tenantId_idx" ON "CannedResponse"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CannedResponse_tenantId_shortcut_key" ON "CannedResponse"("tenantId", "shortcut");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "Session_status_lastActiveAt_idx" ON "Session"("status", "lastActiveAt");

-- CreateIndex
CREATE INDEX "Session_assignedOperatorId_idx" ON "Session"("assignedOperatorId");

-- AddForeignKey
ALTER TABLE "BusinessHours" ADD CONSTRAINT "BusinessHours_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
