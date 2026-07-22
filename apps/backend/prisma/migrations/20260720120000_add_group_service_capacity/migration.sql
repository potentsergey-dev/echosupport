ALTER TABLE "Service" ADD COLUMN "isGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Service" ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Service" ADD CONSTRAINT "Service_capacity_check" CHECK ("capacity" >= 1);
