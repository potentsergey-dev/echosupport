import type { UploadIntent } from '@prisma/client';
import type { DirectUploadStorage, UploadMetadata } from '../contracts/direct-upload.js';
import type { createUploadIntentService } from './upload-intents.js';
import { UploadIntentError, type UploadScope } from './upload-intents.js';
import { validateUploadedObject } from './upload-validation.js';

type IntentService = ReturnType<typeof createUploadIntentService>;
type CreateInput = Parameters<IntentService['create']>[1];
type InspectContent = (bytes: Buffer, intent: UploadIntent) => Promise<void>;

function assertSource(intent: UploadIntent, object: UploadMetadata | null): UploadMetadata {
  const result = validateUploadedObject(
    { key: intent.stagingKey, sizeBytes: intent.sizeBytes, contentType: intent.mimeType },
    object,
  );
  if (!result.valid) throw new UploadIntentError('INVALID');
  if (intent.sourceVersion && result.object.version !== intent.sourceVersion) {
    throw new UploadIntentError('CONFLICT');
  }
  return result.object;
}

function assertFinal(
  intent: UploadIntent,
  sourceVersion: string,
  object: UploadMetadata | null,
): UploadMetadata {
  const result = validateUploadedObject(
    { key: intent.finalKey, sizeBytes: intent.sizeBytes, contentType: intent.mimeType },
    object,
  );
  if (!result.valid) throw new UploadIntentError('INVALID');
  if (
    result.object.promotionSource?.key !== intent.stagingKey ||
    result.object.promotionSource.version !== sourceVersion
  ) {
    throw new UploadIntentError('CONFLICT');
  }
  return result.object;
}

export function createDirectUploadWorkflow(
  intents: IntentService,
  storage: DirectUploadStorage,
  inspectContent: InspectContent,
) {
  return {
    async issue(scope: UploadScope, input: CreateInput) {
      const intent = await intents.create(scope, input);
      if (intent.status !== 'PENDING') throw new UploadIntentError('CONFLICT');
      if (intent.expiresAt.getTime() <= Date.now()) throw new UploadIntentError('EXPIRED');
      const grant = await storage.prepareUpload(
        { key: intent.stagingKey, sizeBytes: intent.sizeBytes, contentType: intent.mimeType },
        intent.expiresAt,
      );
      if (grant.expiresAt.getTime() > intent.expiresAt.getTime()) {
        throw new UploadIntentError('INVALID');
      }
      return { intentId: intent.id, grant };
    },

    async complete(scope: UploadScope, id: string) {
      const intent = await intents.claimCompletion(scope, id);
      const token = intent.leaseToken ?? '';
      if (intent.status !== 'COMPLETED' && !token) throw new UploadIntentError('LEASE_LOST');

      let sourceVersion = intent.sourceVersion;
      if (intent.status === 'COMPLETED' && !sourceVersion) throw new UploadIntentError('INVALID');
      if (!sourceVersion) {
        const source = assertSource(intent, await storage.inspectUpload(intent.stagingKey));
        const bytes = await storage.readObject({ key: source.key, version: source.version });
        if (bytes.length !== intent.sizeBytes) throw new UploadIntentError('INVALID');
        await inspectContent(bytes, intent);
        await intents.recordSource(scope, id, token, source);
        sourceVersion = source.version;
      }

      let final = await storage.inspectUpload(intent.finalKey);
      if (!final) {
        const source = assertSource(intent, await storage.inspectUpload(intent.stagingKey));
        if (source.version !== sourceVersion) throw new UploadIntentError('CONFLICT');
        try {
          final = await storage.promoteUpload(
            { key: source.key, version: sourceVersion },
            intent.finalKey,
          );
        } catch (error: unknown) {
          final = await storage.inspectUpload(intent.finalKey);
          if (!final) throw error;
        }
      }
      const verified = assertFinal(intent, sourceVersion, final);
      if (intent.status !== 'COMPLETED') await intents.renewCompletion(scope, id, token);
      return intents.complete(scope, id, token, verified);
    },
  };
}
