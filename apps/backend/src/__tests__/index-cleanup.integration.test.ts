/* eslint-disable @typescript-eslint/unbound-method */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../db/prisma.js';

vi.mock('../adapters/vectorstore/qdrant.js', () => ({
  deleteByIndexGeneration: vi.fn().mockResolvedValue(undefined),
  deleteLegacyAgentPoints: vi.fn().mockResolvedValue(undefined),
}));

const { deleteByIndexGeneration } = await import('../adapters/vectorstore/qdrant.js');
const { cleanupIndexGenerations } = await import('../services/index-cleanup.js');

const created = { tenantId: '', agentId: '', jobId: '', generationId: '' };

async function fixture() {
  const tenant = await prisma.tenant.create({ data: { name: 'Index cleanup test' } });
  created.tenantId = tenant.id;
  const agent = await prisma.agent.create({
    data: {
      tenantId: tenant.id,
      name: 'Index cleanup test',
      systemPrompt: 'Test',
      publicKey: `cleanup-${randomUUID()}`,
    },
  });
  created.agentId = agent.id;
  const job = await prisma.job.create({
    data: {
      type: 'REINDEX_AGENT',
      agentId: agent.id,
      payload: { agentId: agent.id },
      status: 'RUNNING',
      leaseToken: 'lease-1',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  created.jobId = job.id;
  const generation = await prisma.indexGeneration.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.id,
      agentId: agent.id,
      jobId: job.id,
      leaseToken: 'lease-1',
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    },
  });
  created.generationId = generation.id;
  return generation;
}

describe('index cleanup (PostgreSQL)', () => {
  afterEach(async () => {
    if (created.generationId)
      await prisma.indexGeneration.deleteMany({ where: { id: created.generationId } });
    if (created.jobId) await prisma.job.deleteMany({ where: { id: created.jobId } });
    if (created.agentId) await prisma.agent.deleteMany({ where: { id: created.agentId } });
    if (created.tenantId) await prisma.tenant.deleteMany({ where: { id: created.tenantId } });
    Object.assign(created, { tenantId: '', agentId: '', jobId: '', generationId: '' });
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('waits for the live lease and cleans abandoned staging after expiry', async () => {
    const generation = await fixture();

    expect(await cleanupIndexGenerations()).toBe(0);
    expect(deleteByIndexGeneration).not.toHaveBeenCalled();

    await prisma.job.update({
      where: { id: created.jobId },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await cleanupIndexGenerations()).toBe(1);
    expect(deleteByIndexGeneration).toHaveBeenCalledWith(
      created.tenantId,
      created.agentId,
      generation.id,
    );
    expect(
      (await prisma.indexGeneration.findUniqueOrThrow({ where: { id: generation.id } })).cleanedAt,
    ).not.toBeNull();
  });

  it('never cleans a generation that remains active on the agent', async () => {
    const generation = await fixture();
    await prisma.indexGeneration.update({
      where: { id: generation.id },
      data: { publishedAt: generation.createdAt, retiredAt: generation.createdAt },
    });
    await prisma.agent.update({
      where: { id: created.agentId },
      data: { activeIndexGeneration: generation.id },
    });

    expect(await cleanupIndexGenerations()).toBe(0);
    expect(deleteByIndexGeneration).not.toHaveBeenCalled();
  });
});
