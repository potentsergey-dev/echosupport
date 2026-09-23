ALTER TABLE "Agent" ADD COLUMN "activeIndexGeneration" TEXT;
ALTER TABLE "DocumentChunk" ADD COLUMN "indexGeneration" TEXT;

CREATE INDEX "DocumentChunk_agentId_indexGeneration_idx" ON "DocumentChunk"("agentId", "indexGeneration");
