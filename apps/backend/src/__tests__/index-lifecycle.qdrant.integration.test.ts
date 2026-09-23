/* eslint-disable @typescript-eslint/unbound-method */
import { randomUUID } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';

vi.mock('../adapters/embeddings/openai.js', () => ({ embed: vi.fn() }));
vi.mock('../services/resolve-embedding.js', () => ({
  resolveEmbeddingConfig: vi.fn().mockResolvedValue({ apiKey: 'test-only', model: 'test-model' }),
}));
vi.mock('../services/text-extractor.js', () => ({ extractText: vi.fn() }));

const { embed } = await import('../adapters/embeddings/openai.js');
const {
  deleteByIndexGeneration,
  ensureCollection,
  getCollectionName,
  searchLegacyPoints,
  searchPoints,
  upsertPoints,
} = await import('../adapters/vectorstore/qdrant.js');
const { extractText } = await import('../services/text-extractor.js');
const { cleanupIndexGenerations } = await import('../services/index-cleanup.js');
const { reindexAgent } = await import('../services/indexer.js');
const { createJobLeaseService } = await import('../services/job-leases.js');
const { retrieve } = await import('../services/retriever.js');

const leases = createJobLeaseService(prisma);
const qdrant = new QdrantClient({
  url: env.QDRANT_URL,
  ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
});
const vector = new Array<number>(1536).fill(0);
vector[0] = 1;
const storage = { readFile: vi.fn().mockResolvedValue(Buffer.from('unused')) };
let tenantId: string | undefined;
let agentId: string | undefined;

async function runReindex(agent: string): Promise<void> {
  const job = await prisma.job.create({
    data: { type: 'REINDEX_AGENT', agentId: agent, payload: { agentId: agent } },
  });
  const claim = await leases.claimNext(job.id);
  if (!claim) throw new Error('Could not claim reindex job');
  await reindexAgent(agent, job.id, storage, claim.token);
  await leases.finish(job.id, claim.token);
}

async function points(agent: string, generation?: string) {
  if (!generation) return searchLegacyPoints(tenantId!, agent, vector, 10);
  return searchPoints(
    tenantId!,
    vector,
    {
      must: [
        { key: 'agent_id', match: { value: agent } },
        { key: 'index_generation', match: { value: generation } },
      ],
    },
    10,
  );
}

describe('index lifecycle (PostgreSQL and Qdrant)', () => {
  afterEach(async () => {
    if (agentId) {
      await prisma.indexGeneration.deleteMany({ where: { agentId } });
      await prisma.job.deleteMany({ where: { agentId } });
    }
    if (tenantId) {
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
      const name = getCollectionName(tenantId);
      const { collections } = await qdrant.getCollections();
      if (collections.some((collection) => collection.name === name)) {
        await qdrant.deleteCollection(name);
      }
    }
    tenantId = undefined;
    agentId = undefined;
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('publishes, retrieves, and cleans generations without exposing stale points', async () => {
    vi.mocked(embed).mockImplementation(async (texts) => texts.map(() => vector));
    const tenant = await prisma.tenant.create({ data: { name: 'Qdrant lifecycle test' } });
    tenantId = tenant.id;
    const agent = await prisma.agent.create({
      data: {
        tenantId,
        name: 'Qdrant lifecycle test',
        systemPrompt: 'Test',
        publicKey: `qdrant-${randomUUID()}`,
      },
    });
    agentId = agent.id;
    await prisma.document.create({
      data: {
        agentId,
        filename: 'knowledge.txt',
        mimeType: 'text/plain',
        sizeBytes: 20,
        storagePath: 'test-only/knowledge.txt',
      },
    });

    await ensureCollection(tenantId);
    await upsertPoints(tenantId, [
      {
        id: randomUUID(),
        vector,
        payload: {
          agent_id: agentId,
          source_type: 'FILE',
          source_label: 'legacy.txt',
          content: 'Legacy knowledge',
        },
      },
    ]);
    expect(
      await searchPoints(tenantId, vector, {
        must: [{ key: 'agent_id', match: { value: agentId } }],
      }),
    ).toHaveLength(1);
    expect(await points(agentId)).toHaveLength(1);
    expect((await retrieve(agentId, 'question')).map((chunk) => chunk.content)).toEqual([
      'Legacy knowledge',
    ]);

    vi.mocked(extractText).mockResolvedValue('First published knowledge');
    await runReindex(agentId);
    const first = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    expect(first.activeIndexGeneration).toBeTruthy();
    expect((await retrieve(agentId, 'question')).map((chunk) => chunk.content)).toEqual([
      'First published knowledge',
    ]);
    expect(await points(agentId)).toHaveLength(1);

    const stagedGeneration = randomUUID();
    await upsertPoints(tenantId, [
      {
        id: randomUUID(),
        vector,
        payload: {
          agent_id: agentId,
          index_generation: stagedGeneration,
          source_type: 'FILE',
          content: 'Unpublished knowledge',
        },
      },
    ]);
    expect((await retrieve(agentId, 'question')).map((chunk) => chunk.content)).toEqual([
      'First published knowledge',
    ]);
    await deleteByIndexGeneration(tenantId, agentId, stagedGeneration);

    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await prisma.indexGeneration.update({
      where: { id: `legacy:${agentId}` },
      data: { retiredAt: old },
    });
    expect(await cleanupIndexGenerations()).toBe(1);
    expect(await points(agentId)).toHaveLength(0);
    expect(await points(agentId, first.activeIndexGeneration!)).toHaveLength(1);

    vi.mocked(extractText).mockResolvedValue('Second published knowledge');
    await runReindex(agentId);
    const second = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    expect(second.activeIndexGeneration).not.toBe(first.activeIndexGeneration);
    expect((await retrieve(agentId, 'question')).map((chunk) => chunk.content)).toEqual([
      'Second published knowledge',
    ]);
    expect(await points(agentId, first.activeIndexGeneration!)).toHaveLength(1);

    await prisma.indexGeneration.update({
      where: { id: first.activeIndexGeneration! },
      data: { retiredAt: old },
    });
    expect(await cleanupIndexGenerations()).toBe(1);
    expect(await points(agentId, first.activeIndexGeneration!)).toHaveLength(0);
    expect(await points(agentId, second.activeIndexGeneration!)).toHaveLength(1);

    vi.mocked(extractText).mockRejectedValueOnce(new Error('Expected extraction failure'));
    const failed = await prisma.job.create({
      data: { type: 'REINDEX_AGENT', agentId, payload: { agentId } },
    });
    const claim = await leases.claimNext(failed.id);
    if (!claim) throw new Error('Could not claim failure test job');
    await expect(reindexAgent(agentId, failed.id, storage, claim.token)).rejects.toThrow(
      'Expected extraction failure',
    );
    await leases.finish(failed.id, claim.token, 'Expected extraction failure');
    expect((await retrieve(agentId, 'question')).map((chunk) => chunk.content)).toEqual([
      'Second published knowledge',
    ]);
  }, 60_000);
});
