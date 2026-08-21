import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createAgentWithQuota, withSerializableRetry } from '../services/agent-quota.js';

describe('agent quota service', () => {
  it('creates an agent inside the locked quota transaction', async () => {
    const createdAgent = { id: 'agent-1', name: 'Support Bot' };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      agent: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue(createdAgent),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const entitlements = {
      assertQuota: vi.fn(
        async (_ctx: unknown, _quota: unknown, _delta: unknown, countFn: () => Promise<number>) => {
          await expect(countFn()).resolves.toBe(0);
          return {
            plan: 'Lite',
            features: {},
            quotas: {},
            subscription: { state: 'ACTIVE', access: 'ALLOWED' },
            computedAt: new Date(),
            expiresAt: new Date(),
          };
        },
      ),
    };

    await expect(
      createAgentWithQuota(prisma as never, entitlements as never, {
        tenantId: 'tenant-1',
        userId: 'owner-1',
        data: {
          tenantId: 'tenant-1',
          name: 'Support Bot',
          systemPrompt: 'Answer from approved knowledge.',
          publicKey: 'pk_public',
        },
        select: { id: true, name: true },
      }),
    ).resolves.toBe(createdAgent);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(entitlements.assertQuota).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'owner-1' },
      'agents',
      1,
      expect.any(Function),
    );
    expect(tx.agent.count).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1' } });
    expect(tx.agent.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        name: 'Support Bot',
        systemPrompt: 'Answer from approved knowledge.',
        publicKey: 'pk_public',
      },
      select: { id: true, name: true },
    });
  });

  it('retries serializable write conflicts before surfacing success', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    const operation = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce('ok');

    await expect(withSerializableRetry(operation)).resolves.toBe('ok');

    expect(operation).toHaveBeenCalledTimes(2);
  });
});
