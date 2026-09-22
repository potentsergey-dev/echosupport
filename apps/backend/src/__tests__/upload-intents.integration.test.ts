import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { createUploadIntentService, type UploadScope } from '../services/upload-intents.js';

const service = createUploadIntentService(prisma, async (tx, scope) => {
  const [access] = await tx.$queryRaw<Array<{ role: string; status: string; userStatus: string }>>`
    SELECT m.role, m.status, u.status AS "userStatus" FROM "Membership" m
    JOIN "User" u ON u.id = m."userId"
    WHERE m."tenantId" = ${scope.tenantId} AND m."userId" = ${scope.uploaderId}
    FOR SHARE OF m, u
  `;
  if (
    !access ||
    access.status !== 'ACTIVE' ||
    access.userStatus !== 'ACTIVE' ||
    !['OWNER', 'ADMIN'].includes(access.role)
  )
    throw new Error('Access revoked');
});

let scope: UploadScope;
let input: {
  idempotencyKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: Date;
};
const past = () => new Date(Date.now() - 60_000);

async function claimed() {
  const intent = await service.create(scope, input);
  const lease = await service.claimCompletion(scope, intent.id);
  await service.recordSource(scope, intent.id, lease.leaseToken!, {
    key: intent.stagingKey,
    version: 'source-1',
    sizeBytes: input.sizeBytes,
    contentType: input.mimeType,
  });
  return {
    intent,
    token: lease.leaseToken!,
    object: {
      key: intent.finalKey,
      version: '9007199254740993',
      sizeBytes: input.sizeBytes,
      contentType: input.mimeType,
      promotionSource: { key: intent.stagingKey, version: 'source-1' },
    },
  };
}

describe('upload lifecycle (PostgreSQL)', () => {
  beforeEach(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Upload lifecycle test' } });
    const email = `${randomUUID()}@example.test`;
    const user = await prisma.user.create({ data: { email, normalizedEmail: email } });
    await prisma.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const agent = await prisma.agent.create({
      data: {
        tenantId: tenant.id,
        name: 'Upload agent',
        systemPrompt: 'Test',
        publicKey: randomUUID(),
      },
    });
    scope = { tenantId: tenant.id, agentId: agent.id, uploaderId: user.id };
    input = {
      idempotencyKey: randomUUID(),
      filename: 'test.txt',
      mimeType: 'text/plain',
      sizeBytes: 42,
      expiresAt: new Date(Date.now() + 3_600_000),
    };
  });

  afterEach(async () => {
    await prisma.uploadIntent.deleteMany({ where: { tenantId: scope.tenantId } });
    await prisma.tenant.deleteMany({ where: { id: scope.tenantId } });
    await prisma.user.deleteMany({ where: { id: scope.uploaderId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists one intent for concurrent retries without exposing an indexable document', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.create(scope, input)),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await prisma.document.count({ where: { agentId: scope.agentId } })).toBe(0);
    expect(await prisma.uploadIntent.count({ where: { tenantId: scope.tenantId } })).toBe(1);
  });

  it.each([
    { sizeBytes: 43 },
    { filename: 'changed.txt' },
    { mimeType: 'text/html' },
    { expiresAt: new Date('2099-01-01') },
  ])('rejects idempotency key reuse with different parameters %j', async (change) => {
    await service.create(scope, input);
    await expect(service.create(scope, { ...input, ...change })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('does not allow an intent to be addressed through another tenant, agent or user', async () => {
    const intent = await service.create(scope, input);
    for (const change of [{ tenantId: 'other' }, { agentId: 'other' }, { uploaderId: 'other' }]) {
      await expect(
        service.claimCompletion({ ...scope, ...change }, intent.id),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(service.create({ ...scope, agentId: 'other' }, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('allows exactly one concurrent completion lease', async () => {
    const intent = await service.create(scope, input);
    const results = await Promise.allSettled([
      service.claimCompletion(scope, intent.id),
      service.claimCompletion(scope, intent.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('commits exactly one document for concurrent completion and retains its opaque version', async () => {
    const { intent, token, object } = await claimed();
    const results = await Promise.all([
      service.complete(scope, intent.id, token, object),
      service.complete(scope, intent.id, token, object),
    ]);
    expect(results.map((r) => r.id)).toEqual([intent.documentId, intent.documentId]);
    expect(results[0]?.storageVersion).toBe('9007199254740993');
    expect(await prisma.document.count({ where: { agentId: scope.agentId } })).toBe(1);
    expect(await service.claimCompletion(scope, intent.id)).toMatchObject({
      status: 'COMPLETED',
      leaseToken: null,
    });
  });

  it('rejects missing verification and changed source/final object metadata', async () => {
    const intent = await service.create(scope, input);
    const lease = await service.claimCompletion(scope, intent.id);
    const final = {
      key: intent.finalKey,
      version: 'final',
      sizeBytes: input.sizeBytes,
      contentType: input.mimeType,
    };
    await expect(
      service.complete(scope, intent.id, lease.leaseToken!, final),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      service.recordSource(scope, intent.id, lease.leaseToken!, {
        ...final,
        key: intent.stagingKey,
        sizeBytes: 43,
      }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await service.recordSource(scope, intent.id, lease.leaseToken!, {
      ...final,
      key: intent.stagingKey,
      version: 'source',
    });
    await expect(
      service.recordSource(scope, intent.id, lease.leaseToken!, {
        ...final,
        key: intent.stagingKey,
        version: 'replacement',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      service.complete(scope, intent.id, lease.leaseToken!, { ...final, key: 'unrelated' }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      service.complete(scope, intent.id, lease.leaseToken!, {
        ...final,
        promotionSource: { key: intent.stagingKey, version: 'replacement' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('recovers after an expired lease and fences out its previous owner', async () => {
    const { intent, token, object } = await claimed();
    await prisma.uploadIntent.update({
      where: { id: intent.id },
      data: { leaseExpiresAt: past() },
    });
    const recovered = await service.claimCompletion(scope, intent.id);
    expect(recovered.sourceVersion).toBe('source-1');
    expect(recovered.leaseToken).not.toBe(token);
    await expect(service.complete(scope, intent.id, token, object)).rejects.toMatchObject({
      code: 'LEASE_LOST',
    });
    await expect(service.renewCompletion(scope, intent.id, token)).rejects.toMatchObject({
      code: 'LEASE_LOST',
    });
    await expect(
      service.complete(scope, intent.id, recovered.leaseToken!, object),
    ).resolves.toMatchObject({ id: intent.documentId });
  });

  it.each(['REMOVED', 'SUSPENDED'] as const)(
    'rechecks authorization after %s membership revocation',
    async (status) => {
      const { intent, token, object } = await claimed();
      await prisma.membership.updateMany({ where: { tenantId: scope.tenantId }, data: { status } });
      await expect(service.complete(scope, intent.id, token, object)).rejects.toThrow(
        'Access revoked',
      );
      expect(await prisma.document.count({ where: { agentId: scope.agentId } })).toBe(0);
    },
  );

  it('rolls back completion when document insertion fails and allows retry', async () => {
    const { intent, token, object } = await claimed();
    await prisma.document.create({
      data: {
        id: intent.documentId,
        agentId: scope.agentId,
        filename: 'collision',
        mimeType: 'text/plain',
        sizeBytes: 1,
        storagePath: 'collision',
      },
    });
    await expect(service.complete(scope, intent.id, token, object)).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(await prisma.uploadIntent.findUniqueOrThrow({ where: { id: intent.id } })).toMatchObject(
      { status: 'PROCESSING', finalVersion: null },
    );
    await prisma.document.delete({ where: { id: intent.documentId } });
    await expect(service.complete(scope, intent.id, token, object)).resolves.toMatchObject({
      id: intent.documentId,
    });
  });

  it('does not recreate a deleted completed document on replay', async () => {
    const { intent, token, object } = await claimed();
    await service.complete(scope, intent.id, token, object);
    await prisma.document.delete({ where: { id: intent.documentId } });
    await expect(service.complete(scope, intent.id, token, object)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await prisma.document.count({ where: { agentId: scope.agentId } })).toBe(0);
  });

  it('protects active completion leases and accepted final objects from cleanup', async () => {
    const { intent, token, object } = await claimed();
    await prisma.uploadIntent.update({
      where: { id: intent.id },
      data: { expiresAt: past(), cleanupAfter: past() },
    });
    await expect(service.claimCleanup(intent.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await service.complete(scope, intent.id, token, object);
    const cleanup = await service.claimCleanup(intent.id);
    expect(cleanup.deleteFinalObject).toBe(false);
    await service.finishCleanup(intent.id, cleanup.intent.cleanupToken!);
    expect(await prisma.document.findUnique({ where: { id: intent.documentId } })).not.toBeNull();
  });

  it('lets cleanup fence stale completion and reschedules reconciliation for late writes', async () => {
    const { intent, token, object } = await claimed();
    await prisma.uploadIntent.update({
      where: { id: intent.id },
      data: { expiresAt: past(), cleanupAfter: past(), leaseExpiresAt: past() },
    });
    const results = await Promise.allSettled([
      service.complete(scope, intent.id, token, object),
      service.claimCleanup(intent.id),
    ]);
    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('fulfilled');
    const expired = await prisma.uploadIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(expired.status).toBe('EXPIRED');
    await service.finishCleanup(intent.id, expired.cleanupToken!);
    await expect(service.claimCleanup(intent.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await prisma.uploadIntent.update({ where: { id: intent.id }, data: { cleanupAfter: past() } });
    const next = await service.claimCleanup(intent.id);
    expect(next.deleteFinalObject).toBe(true);
    await expect(service.finishCleanup(intent.id, expired.cleanupToken!)).rejects.toMatchObject({
      code: 'LEASE_LOST',
    });
    await service.finishCleanup(intent.id, next.intent.cleanupToken!);
    await expect(service.claimCompletion(scope, intent.id)).rejects.toMatchObject({
      code: 'EXPIRED',
    });
  });

  it('retains cleanup state after agent and uploader deletion', async () => {
    const intent = await service.create(scope, input);
    await prisma.agent.delete({ where: { id: scope.agentId } });
    await prisma.user.delete({ where: { id: scope.uploaderId } });
    await prisma.uploadIntent.update({
      where: { id: intent.id },
      data: { expiresAt: past(), cleanupAfter: past() },
    });
    expect((await service.claimCleanup(intent.id)).deleteFinalObject).toBe(true);
  });

  it('reconciles an accepted object after its agent and document were deleted', async () => {
    const { intent, token, object } = await claimed();
    await service.complete(scope, intent.id, token, object);
    await prisma.agent.delete({ where: { id: scope.agentId } });
    await prisma.uploadIntent.update({ where: { id: intent.id }, data: { cleanupAfter: past() } });
    const cleanup = await service.claimCleanup(intent.id);
    expect(cleanup.deleteFinalObject).toBe(true);
    expect(cleanup.intent.finalVersion).toBe(object.version);
  });

  it('allows one cleanup owner and recovers its lease after a worker crash', async () => {
    const intent = await service.create(scope, input);
    await prisma.uploadIntent.update({
      where: { id: intent.id },
      data: { expiresAt: past(), cleanupAfter: past() },
    });
    const results = await Promise.allSettled([
      service.claimCleanup(intent.id),
      service.claimCleanup(intent.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const first = await prisma.uploadIntent.findUniqueOrThrow({ where: { id: intent.id } });
    await prisma.uploadIntent.update({
      where: { id: intent.id },
      data: { cleanupExpiresAt: past() },
    });
    const recovered = await service.claimCleanup(intent.id);
    expect(recovered.intent.cleanupToken).not.toBe(first.cleanupToken);
    await expect(service.finishCleanup(intent.id, first.cleanupToken!)).rejects.toMatchObject({
      code: 'LEASE_LOST',
    });
    await service.finishCleanup(intent.id, recovered.intent.cleanupToken!);
  });
});
