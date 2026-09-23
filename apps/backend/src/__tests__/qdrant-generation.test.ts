/* eslint-disable @typescript-eslint/unbound-method */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'kb_tenant_tenant-1' }] }),
  delete: vi.fn().mockResolvedValue(undefined),
  scroll: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: class {
    getCollections = client.getCollections;
    delete = client.delete;
    scroll = client.scroll;
    query = client.query;
  },
}));

vi.mock('../config/env.js', () => ({ env: { QDRANT_URL: 'http://localhost:6333' } }));

const { deleteByIndexGeneration, deleteLegacyAgentPoints, searchLegacyPoints } =
  await import('../adapters/vectorstore/qdrant.js');

describe('Qdrant generation deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.getCollections.mockResolvedValue({ collections: [{ name: 'kb_tenant_tenant-1' }] });
    client.scroll.mockResolvedValue({ points: [], next_page_offset: null });
    client.query.mockResolvedValue({ points: [] });
  });

  it('limits deletion to the tenant, agent, and generation', async () => {
    await deleteByIndexGeneration('tenant-1', 'agent-1', 'generation-1');

    expect(client.delete).toHaveBeenCalledWith('kb_tenant_tenant-1', {
      wait: true,
      filter: {
        must: [
          { key: 'agent_id', match: { value: 'agent-1' } },
          { key: 'index_generation', match: { value: 'generation-1' } },
        ],
      },
    });
  });

  it('deletes only legacy points without an index generation', async () => {
    client.scroll.mockResolvedValueOnce({
      points: [
        { id: 'legacy', payload: { agent_id: 'agent-1' } },
        { id: 'staged', payload: { agent_id: 'agent-1', index_generation: 'generation-2' } },
      ],
      next_page_offset: null,
    });
    await deleteLegacyAgentPoints('tenant-1', 'agent-1');

    expect(client.delete).toHaveBeenCalledWith('kb_tenant_tenant-1', {
      wait: true,
      points: ['legacy'],
    });
  });

  it('ranks only legacy points across scroll pages', async () => {
    client.scroll
      .mockResolvedValueOnce({
        points: [
          { id: 'legacy-1', payload: { index_generation: null, source_type: 'FILE' } },
          { id: 'staged', payload: { index_generation: 'generation-2', source_type: 'FILE' } },
        ],
        next_page_offset: 'staged',
      })
      .mockResolvedValueOnce({
        points: [{ id: 'legacy-2', payload: { source_type: 'FILE' } }],
        next_page_offset: null,
      });
    client.query
      .mockResolvedValueOnce({ points: [{ id: 'legacy-1', score: 0.4 }] })
      .mockResolvedValueOnce({ points: [{ id: 'legacy-2', score: 0.9 }] });

    const result = await searchLegacyPoints('tenant-1', 'agent-1', [1], 1, 'FILE');

    expect(result.map((point) => point.id)).toEqual(['legacy-2']);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query).toHaveBeenNthCalledWith(1, 'kb_tenant_tenant-1', {
      query: [1],
      filter: {
        must: [{ key: 'agent_id', match: { value: 'agent-1' } }, { has_id: ['legacy-1'] }],
      },
      limit: 1,
      with_payload: true,
    });
    expect(client.query).toHaveBeenNthCalledWith(2, 'kb_tenant_tenant-1', {
      query: [1],
      filter: {
        must: [{ key: 'agent_id', match: { value: 'agent-1' } }, { has_id: ['legacy-2'] }],
      },
      limit: 1,
      with_payload: true,
    });
  });

  it('treats a removed tenant collection as already cleaned', async () => {
    client.getCollections.mockResolvedValueOnce({ collections: [] });

    await deleteByIndexGeneration('tenant-1', 'agent-1', 'generation-1');

    expect(client.delete).not.toHaveBeenCalled();
  });
});
