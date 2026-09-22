import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, UploadIntent } from '@prisma/client';
import type { UploadMetadata } from '../contracts/direct-upload.js';
import { validateUploadedObject } from './upload-validation.js';

const LEASE_MS = 60_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000;

export interface UploadScope {
  tenantId: string;
  agentId: string;
  uploaderId: string;
}

// Must recheck current access using this transaction, not a cached authorization result.
export type AuthorizeUpload = (tx: Prisma.TransactionClient, scope: UploadScope) => Promise<void>;

export class UploadIntentError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'EXPIRED' | 'LEASE_LOST' | 'INVALID',
  ) {
    super(`Upload intent: ${code}`);
  }
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return row!.now;
}

async function lockIntent(tx: Prisma.TransactionClient, id: string): Promise<UploadIntent> {
  const [intent] = await tx.$queryRaw<UploadIntent[]>`
    SELECT * FROM "UploadIntent" WHERE "id" = ${id} FOR UPDATE
  `;
  if (!intent) throw new UploadIntentError('NOT_FOUND');
  return intent;
}

function assertLease(intent: UploadIntent, token: string, now: Date): void {
  if (
    intent.status !== 'PROCESSING' ||
    intent.leaseToken !== token ||
    !intent.leaseExpiresAt ||
    intent.leaseExpiresAt <= now
  ) {
    throw new UploadIntentError('LEASE_LOST');
  }
}

export function createUploadIntentService(prisma: PrismaClient, authorize: AuthorizeUpload) {
  async function withAuthorizedIntent<T>(
    scope: UploadScope,
    id: string,
    operation: (tx: Prisma.TransactionClient, intent: UploadIntent, now: Date) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      const intent = await lockIntent(tx, id);
      if (
        intent.tenantId !== scope.tenantId ||
        intent.agentId !== scope.agentId ||
        intent.uploaderId !== scope.uploaderId
      ) {
        throw new UploadIntentError('NOT_FOUND');
      }
      await authorize(tx, scope);
      const agent = await tx.agent.findFirst({
        where: { id: scope.agentId, tenantId: scope.tenantId },
      });
      if (!agent) throw new UploadIntentError('NOT_FOUND');
      return operation(tx, intent, await databaseNow(tx));
    });
  }

  return {
    async create(
      scope: UploadScope,
      input: {
        idempotencyKey: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
        expiresAt: Date;
      },
    ) {
      if (
        !input.idempotencyKey.trim() ||
        input.idempotencyKey.length > 128 ||
        !input.filename.trim() ||
        input.filename.length > 255 ||
        !input.mimeType.trim() ||
        input.mimeType.length > 255 ||
        !Number.isSafeInteger(input.sizeBytes) ||
        input.sizeBytes <= 0 ||
        input.sizeBytes > 2147483647 ||
        !Number.isFinite(input.expiresAt.getTime())
      )
        throw new UploadIntentError('INVALID');

      return prisma.$transaction(async (tx) => {
        await authorize(tx, scope);
        const agent = await tx.agent.findFirst({
          where: { id: scope.agentId, tenantId: scope.tenantId },
        });
        if (!agent) throw new UploadIntentError('NOT_FOUND');
        // Serialize initial creation without relying on catching a failed unique insert.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.tenantId}), hashtext(${input.idempotencyKey}))`;
        const existing = await tx.uploadIntent.findUnique({
          where: {
            tenantId_idempotencyKey: {
              tenantId: scope.tenantId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) {
          if (
            existing.agentId !== scope.agentId ||
            existing.uploaderId !== scope.uploaderId ||
            existing.filename !== input.filename ||
            existing.mimeType !== input.mimeType ||
            existing.sizeBytes !== input.sizeBytes ||
            existing.expiresAt.getTime() !== input.expiresAt.getTime()
          ) {
            throw new UploadIntentError('CONFLICT');
          }
          return existing;
        }
        const now = await databaseNow(tx);
        if (input.expiresAt <= now) throw new UploadIntentError('EXPIRED');
        const id = randomUUID();
        const documentId = randomUUID();
        const prefix = `${encodeURIComponent(scope.tenantId)}/${encodeURIComponent(scope.agentId)}`;
        return tx.uploadIntent.create({
          data: {
            ...scope,
            ...input,
            id,
            documentId,
            stagingKey: `${prefix}/uploads/${id}`,
            finalKey: `${prefix}/documents/${documentId}`,
            cleanupAfter: input.expiresAt,
          },
        });
      });
    },

    claimCompletion(scope: UploadScope, id: string) {
      return withAuthorizedIntent(scope, id, async (tx, intent, now) => {
        if (intent.status === 'COMPLETED') return intent;
        if (intent.status === 'EXPIRED' || intent.expiresAt <= now)
          throw new UploadIntentError('EXPIRED');
        if (intent.leaseExpiresAt && intent.leaseExpiresAt > now)
          throw new UploadIntentError('CONFLICT');
        return tx.uploadIntent.update({
          where: { id },
          data: {
            status: 'PROCESSING',
            leaseToken: randomUUID(),
            leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          },
        });
      });
    },

    renewCompletion(scope: UploadScope, id: string, token: string) {
      return withAuthorizedIntent(scope, id, async (tx, intent, now) => {
        assertLease(intent, token, now);
        return tx.uploadIntent.update({
          where: { id },
          data: { leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
        });
      });
    },

    recordSource(scope: UploadScope, id: string, token: string, object: UploadMetadata) {
      return withAuthorizedIntent(scope, id, async (tx, intent, now) => {
        assertLease(intent, token, now);
        const result = validateUploadedObject(
          { key: intent.stagingKey, sizeBytes: intent.sizeBytes, contentType: intent.mimeType },
          object,
        );
        if (!result.valid) throw new UploadIntentError('INVALID');
        if (intent.sourceVersion && intent.sourceVersion !== object.version)
          throw new UploadIntentError('CONFLICT');
        return tx.uploadIntent.update({ where: { id }, data: { sourceVersion: object.version } });
      });
    },

    complete(scope: UploadScope, id: string, token: string, object: UploadMetadata) {
      return withAuthorizedIntent(scope, id, async (tx, intent, now) => {
        if (intent.status === 'COMPLETED') {
          if (
            object.key !== intent.finalKey ||
            object.version !== intent.finalVersion ||
            object.sizeBytes !== intent.sizeBytes ||
            object.contentType !== intent.mimeType ||
            object.promotionSource?.key !== intent.stagingKey ||
            object.promotionSource.version !== intent.sourceVersion
          )
            throw new UploadIntentError('CONFLICT');
          const document = await tx.document.findUnique({ where: { id: intent.documentId } });
          if (!document) throw new UploadIntentError('NOT_FOUND');
          return document;
        }
        assertLease(intent, token, now);
        if (
          !intent.sourceVersion ||
          !validateUploadedObject(
            { key: intent.finalKey, sizeBytes: intent.sizeBytes, contentType: intent.mimeType },
            object,
          ).valid ||
          object.promotionSource?.key !== intent.stagingKey ||
          object.promotionSource.version !== intent.sourceVersion
        ) {
          throw new UploadIntentError('INVALID');
        }
        const document = await tx.document.create({
          data: {
            id: intent.documentId,
            agentId: intent.agentId,
            filename: intent.filename,
            mimeType: intent.mimeType,
            sizeBytes: intent.sizeBytes,
            storagePath: intent.finalKey,
            storageVersion: object.version,
            status: 'PENDING',
          },
        });
        await tx.uploadIntent.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            finalVersion: object.version,
            completedAt: now,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        return document;
      });
    },

    // Worker-only API. Tombstones survive entity deletion and are never client-addressable.
    claimCleanup(id: string) {
      return prisma.$transaction(async (tx) => {
        const intent = await lockIntent(tx, id);
        const now = await databaseNow(tx);
        if (
          intent.cleanupAfter > now ||
          (intent.cleanupExpiresAt && intent.cleanupExpiresAt > now) ||
          (intent.leaseExpiresAt && intent.leaseExpiresAt > now)
        )
          throw new UploadIntentError('CONFLICT');
        if (intent.status !== 'COMPLETED' && intent.expiresAt > now)
          throw new UploadIntentError('CONFLICT');
        const updated = await tx.uploadIntent.update({
          where: { id },
          data: {
            status: intent.status === 'COMPLETED' ? 'COMPLETED' : 'EXPIRED',
            leaseToken: null,
            leaseExpiresAt: null,
            cleanupToken: randomUUID(),
            cleanupExpiresAt: new Date(now.getTime() + LEASE_MS),
          },
        });
        const document =
          updated.status === 'COMPLETED'
            ? await tx.document.findUnique({
                where: { id: updated.documentId },
                select: { id: true },
              })
            : null;
        return { intent: updated, deleteFinalObject: !document };
      });
    },

    finishCleanup(id: string, token: string) {
      return prisma.$transaction(async (tx) => {
        const intent = await lockIntent(tx, id);
        const now = await databaseNow(tx);
        if (
          intent.cleanupToken !== token ||
          !intent.cleanupExpiresAt ||
          intent.cleanupExpiresAt <= now
        ) {
          throw new UploadIntentError('LEASE_LOST');
        }
        // Repeat reconciliation to catch late writes from grants or stalled old workers.
        return tx.uploadIntent.update({
          where: { id },
          data: {
            cleanupToken: null,
            cleanupExpiresAt: null,
            cleanupAfter: new Date(now.getTime() + CLEANUP_INTERVAL_MS),
          },
        });
      });
    },
  };
}
