import type { PrismaClient, UploadIntent } from '@prisma/client';
import type { DirectUploadStorage, UploadMetadata } from '../contracts/direct-upload.js';
import { sanitizeErrorMessage } from './error-sanitizer.js';
import { UploadIntentError, type createUploadIntentService } from './upload-intents.js';

type IntentService = ReturnType<typeof createUploadIntentService>;

function assertFinalOwner(intent: UploadIntent, object: UploadMetadata): void {
  if (
    !intent.sourceVersion ||
    object.key !== intent.finalKey ||
    object.promotionSource?.key !== intent.stagingKey ||
    object.promotionSource.version !== intent.sourceVersion ||
    (intent.finalVersion && object.version !== intent.finalVersion)
  ) {
    throw new UploadIntentError('CONFLICT');
  }
}

export function createDirectUploadCleanup(
  prisma: PrismaClient,
  intents: IntentService,
  storage: DirectUploadStorage,
) {
  async function cleanupOne(id: string): Promise<void> {
    const { intent, deleteFinalObject } = await intents.claimCleanup(id);
    const token = intent.cleanupToken;
    if (!token) throw new UploadIntentError('LEASE_LOST');

    const staging = await storage.inspectUpload(intent.stagingKey);
    if (staging) {
      if (staging.key !== intent.stagingKey || !staging.version) {
        throw new UploadIntentError('INVALID');
      }
      await storage.deleteObject({ key: intent.stagingKey, version: staging.version });
    }
    if (intent.sourceVersion && intent.sourceVersion !== staging?.version) {
      await storage.deleteObject({ key: intent.stagingKey, version: intent.sourceVersion });
    }

    if (deleteFinalObject) {
      const final = await storage.inspectUpload(intent.finalKey);
      if (final) {
        assertFinalOwner(intent, final);
        await storage.deleteObject({ key: intent.finalKey, version: final.version });
      }
      if (intent.finalVersion && intent.finalVersion !== final?.version) {
        await storage.deleteObject({ key: intent.finalKey, version: intent.finalVersion });
      }
    }
    await intents.finishCleanup(id, token);
  }

  return {
    async run(limit = 100): Promise<number> {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError('Invalid cleanup limit');
      const pageSize = Math.min(limit, 100);
      let cursor: string | undefined;
      let cleaned = 0;
      for (let page = 0; page < 10 && cleaned < limit; page++) {
        const candidates = await prisma.uploadIntent.findMany({
          where: { cleanupAfter: { lte: new Date() } },
          orderBy: [{ cleanupAfter: 'asc' }, { id: 'asc' }],
          take: pageSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true },
        });
        if (candidates.length === 0) break;
        cursor = candidates[candidates.length - 1]!.id;
        for (const candidate of candidates) {
          if (cleaned >= limit) break;
          try {
            await cleanupOne(candidate.id);
            cleaned++;
          } catch (error: unknown) {
            if (!(error instanceof UploadIntentError && error.code === 'CONFLICT')) {
              console.warn('[upload-cleanup] Intent cleanup failed:', sanitizeErrorMessage(error));
            }
          }
        }
        if (candidates.length < pageSize) break;
      }
      return cleaned;
    },
  };
}
