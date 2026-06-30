-- CreateEnum
CREATE TYPE "STTProvider" AS ENUM ('DEEPGRAM', 'WHISPER');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "sttProvider" "STTProvider" NOT NULL DEFAULT 'DEEPGRAM';
