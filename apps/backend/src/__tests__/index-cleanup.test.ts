/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../adapters/vectorstore/qdrant.js', () => ({
  deleteByIndexGeneration: vi.fn().mockResolvedValue(undefined),
  deleteLegacyAgentPoints: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    agent: { findUnique: vi.fn() },
    indexGeneration: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    documentChunk: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}));

const { prisma } = await import('../db/prisma.js');
const { deleteByIndexGeneration, deleteLegacyAgentPoints } =
  await import('../adapters/vectorstore/qdrant.js');
const { cleanupIndexGenerations } = await import('../services/index-cleanup.js');

const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
const generation = {
  id: 'generation-1',
  agentId: 'agent-1',
  tenantId: 'tenant-1',
  jobId: 'job-1',
  leaseToken: 'lease-1',
  legacy: false,
  createdAt: old,
  publishedAt: old,
  retiredAt: old,
  cleanedAt: null,
  cleanupToken: null,
  cleanupLeaseExpiresAt: null,
};

describe('index generation cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteByIndexGeneration).mockResolvedValue(undefined);
    vi.mocked(prisma.$transaction).mockImplementation(async (work) => work(prisma as never));
    vi.mocked(prisma.$queryRaw).mockImplementation(((parts: TemplateStringsArray) =>
      Promise.resolve(
        String(parts[0]).includes('FROM "Job"')
          ? [{ status: 'DONE', leaseToken: null, leaseExpiresAt: null }]
          : [{ now: new Date() }],
      )) as never);
    vi.mocked(prisma.indexGeneration.findMany).mockResolvedValue([generation] as never);
    vi.mocked(prisma.indexGeneration.findUnique).mockResolvedValue(generation as never);
    vi.mocked(prisma.indexGeneration.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      activeIndexGeneration: 'generation-2',
    } as never);
  });

  it('deletes a retired generation after the retention period', async () => {
    expect(await cleanupIndexGenerations()).toBe(1);
    expect(deleteByIndexGeneration).toHaveBeenCalledWith('tenant-1', 'agent-1', 'generation-1');
    expect(prisma.indexGeneration.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'generation-1', cleanupToken: expect.any(String) }),
      data: expect.objectContaining({ cleanedAt: expect.any(Date), cleanupToken: null }),
    });
    expect(prisma.indexGeneration.deleteMany).toHaveBeenCalledWith({
      where: { cleanedAt: { lt: expect.any(Date) } },
    });
  });

  it('never deletes the agent active generation', async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValueOnce({
      activeIndexGeneration: 'generation-1',
    } as never);
    expect(await cleanupIndexGenerations()).toBe(0);
    expect(deleteByIndexGeneration).not.toHaveBeenCalled();
  });

  it('does not delete abandoned staging while its job lease is live', async () => {
    const staged = { ...generation, publishedAt: null, retiredAt: null };
    vi.mocked(prisma.indexGeneration.findMany).mockResolvedValueOnce([staged] as never);
    vi.mocked(prisma.indexGeneration.findUnique).mockResolvedValueOnce(staged as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { status: 'RUNNING', leaseToken: 'lease-1', leaseExpiresAt: new Date(Date.now() + 60_000) },
    ] as never);

    expect(await cleanupIndexGenerations()).toBe(0);
    expect(deleteByIndexGeneration).not.toHaveBeenCalled();
  });

  it('deletes abandoned staging after the old lease expires', async () => {
    const staged = { ...generation, publishedAt: null, retiredAt: null };
    vi.mocked(prisma.indexGeneration.findMany).mockResolvedValueOnce([staged] as never);
    vi.mocked(prisma.indexGeneration.findUnique).mockResolvedValueOnce(staged as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { status: 'RUNNING', leaseToken: 'lease-1', leaseExpiresAt: old },
    ] as never);

    expect(await cleanupIndexGenerations()).toBe(1);
    expect(deleteByIndexGeneration).toHaveBeenCalledOnce();
  });

  it('uses the legacy-only filter for points without a generation', async () => {
    const legacy = { ...generation, id: 'legacy:agent-1', legacy: true };
    vi.mocked(prisma.indexGeneration.findMany).mockResolvedValueOnce([legacy] as never);
    vi.mocked(prisma.indexGeneration.findUnique).mockResolvedValueOnce(legacy as never);

    expect(await cleanupIndexGenerations()).toBe(1);
    expect(deleteLegacyAgentPoints).toHaveBeenCalledWith('tenant-1', 'agent-1');
    expect(deleteByIndexGeneration).not.toHaveBeenCalled();
  });

  it('leaves a failed Qdrant deletion available for retry', async () => {
    vi.mocked(deleteByIndexGeneration).mockRejectedValueOnce(new Error('Qdrant unavailable'));

    expect(await cleanupIndexGenerations()).toBe(0);
    expect(prisma.documentChunk.deleteMany).not.toHaveBeenCalled();
    expect(await cleanupIndexGenerations()).toBe(1);
  });

  it('continues to later candidates when an older generation is still active', async () => {
    const next = { ...generation, id: 'generation-2' };
    vi.mocked(prisma.indexGeneration.findMany)
      .mockResolvedValueOnce([generation] as never)
      .mockResolvedValueOnce([next] as never);
    vi.mocked(prisma.indexGeneration.findUnique)
      .mockResolvedValueOnce(generation as never)
      .mockResolvedValueOnce(next as never);
    vi.mocked(prisma.agent.findUnique)
      .mockResolvedValueOnce({ activeIndexGeneration: 'generation-1' } as never)
      .mockResolvedValueOnce({ activeIndexGeneration: 'generation-3' } as never);

    expect(await cleanupIndexGenerations(1)).toBe(1);
    expect(prisma.indexGeneration.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { id: 'generation-1' }, skip: 1 }),
    );
    expect(deleteByIndexGeneration).toHaveBeenCalledWith('tenant-1', 'agent-1', 'generation-2');
  });
});
