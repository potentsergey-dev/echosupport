import { vi, describe, it, expect } from 'vitest';

// ── Mock env ────────────────────────────────────────────────────────────────
vi.mock('../config/env.js', () => ({
  env: {
    MASTER_ENCRYPTION_KEY: 'a'.repeat(64),
    NODE_ENV: 'test' as const,
    PORT: 3000,
    HOST: '0.0.0.0',
    DATABASE_URL: 'postgresql://test',
    JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
    ADMIN_CORS_ORIGINS: 'http://localhost:5173',
    UPLOADS_DIR: './uploads',
    APP_URL: 'http://localhost:3000',
    OPENAI_API_KEY: 'test-key',
    QDRANT_URL: 'http://localhost:6333',
    MAX_DOCUMENT_SIZE_MB: 50,
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENROUTER_API_KEY: '',
    DEEPGRAM_API_KEY: '',
  },
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    agent: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'agent-1',
        tenantId: 'tenant-1',
        embeddingModel: 'text-embedding-3-small',
      }),
    },
  },
}));

vi.mock('../services/agent-secrets.js', () => ({
  getAgentSecrets: vi.fn().mockRejectedValue(new Error('no secrets')),
}));

vi.mock('../adapters/embeddings/openai.js', () => ({
  embed: vi.fn().mockResolvedValue([new Array(1536).fill(0.1)]),
}));

// ── Helpers to create fake Qdrant search results ─────────────────────────────

function makeSearchResult(payload: Record<string, unknown>) {
  return { id: 'point-1', version: 0, score: 0.95, payload };
}

vi.mock('../adapters/vectorstore/qdrant.js', () => ({
  searchPoints: vi.fn(),
}));

const { searchPoints } = await import('../adapters/vectorstore/qdrant.js');
const { retrieve } = await import('../services/retriever.js');

describe('retriever — content extraction from Qdrant payload', () => {
  it('returns content from payload.content field (post-BUG1-fix)', async () => {
    const fullContent = 'This is the complete text of the chunk, not just a preview.';
    vi.mocked(searchPoints).mockResolvedValueOnce([
      makeSearchResult({
        agent_id: 'agent-1',
        source_type: 'FILE',
        source_label: 'doc.pdf',
        content: fullContent,
        content_preview: fullContent.slice(0, 50),
      }),
    ]);

    const results = await retrieve('agent-1', 'test query');
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe(fullContent);
  });

  it('returns empty string if payload.content is missing (pre-fix data)', async () => {
    vi.mocked(searchPoints).mockResolvedValueOnce([
      makeSearchResult({
        agent_id: 'agent-1',
        source_type: 'FILE',
        source_label: 'old.pdf',
        // no 'content' field — simulates pre-fix Qdrant data
        content_preview: 'short preview only',
      }),
    ]);

    const results = await retrieve('agent-1', 'test query');
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe(''); // graceful degradation
  });

  it('correctly maps source_type from payload', async () => {
    vi.mocked(searchPoints).mockResolvedValueOnce([
      makeSearchResult({ agent_id: 'agent-1', source_type: 'FILE', content: 'text' }),
      makeSearchResult({ agent_id: 'agent-1', source_type: 'URL', content: 'web' }),
    ]);

    const results = await retrieve('agent-1', 'query');
    expect(results[0]!.sourceType).toBe('FILE');
    expect(results[1]!.sourceType).toBe('URL');
  });
  it('returns no context when vector search is unavailable', async () => {
    vi.mocked(searchPoints).mockRejectedValueOnce(new Error('Not Found'));

    const results = await retrieve('agent-1', 'query');
    expect(results).toEqual([]);
  });

  it('uses FILES_FIRST filter with uppercase FILE value', async () => {
    vi.mocked(searchPoints).mockClear(); // start fresh — no calls from previous tests
    vi.mocked(searchPoints).mockResolvedValue([
      makeSearchResult({ agent_id: 'agent-1', source_type: 'FILE', content: 'file text' }),
    ]);

    await retrieve('agent-1', 'query', { sourcePriority: 'FILES_FIRST' });

    // First call should be the preferred-type filter (has source_type constraint)
    const calls = vi.mocked(searchPoints).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const preferredFilterCall = calls[0]!;
    const filter = preferredFilterCall[2] as {
      must: Array<{ key: string; match: { value: string } }>;
    };
    const sourceTypeFilter = filter.must.find((f) => f.key === 'source_type');
    expect(sourceTypeFilter?.match.value).toBe('FILE');
  });
});
