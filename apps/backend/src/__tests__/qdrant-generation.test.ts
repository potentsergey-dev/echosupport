/* eslint-disable @typescript-eslint/unbound-method */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'kb_tenant_tenant-1' }] }),
  delete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: class {
    getCollections = client.getCollections;
    delete = client.delete;
  },
}));

vi.mock('../config/env.js', () => ({ env: { QDRANT_URL: 'http://localhost:6333' } }));

const { deleteByIndexGeneration, deleteLegacyAgentPoints } =
  await import('../adapters/vectorstore/qdrant.js');

describe('Qdrant generation deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.getCollections.mockResolvedValue({ collections: [{ name: 'kb_tenant_tenant-1' }] });
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
    await deleteLegacyAgentPoints('tenant-1', 'agent-1');

    expect(client.delete).toHaveBeenCalledWith('kb_tenant_tenant-1', {
      wait: true,
      filter: {
        must: [
          { key: 'agent_id', match: { value: 'agent-1' } },
          { is_empty: { key: 'index_generation' } },
        ],
      },
    });
  });

  it('treats a removed tenant collection as already cleaned', async () => {
    client.getCollections.mockResolvedValueOnce({ collections: [] });

    await deleteByIndexGeneration('tenant-1', 'agent-1', 'generation-1');

    expect(client.delete).not.toHaveBeenCalled();
  });
});
