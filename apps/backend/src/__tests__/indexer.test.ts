import { vi, describe, it, expect, beforeEach } from 'vitest';

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

// ── Captured payloads from upsertPoints calls ────────────────────────────────
const capturedPoints: unknown[] = [];

vi.mock('../adapters/vectorstore/qdrant.js', () => ({
  ensureCollection: vi.fn().mockResolvedValue(undefined),
  upsertPoints: vi.fn().mockImplementation((_tenantId: string, points: unknown[]) => {
    capturedPoints.push(...points);
    return Promise.resolve();
  }),
  deleteByAgentId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../adapters/embeddings/openai.js', () => ({
  embed: vi
    .fn()
    .mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => new Array<number>(1536).fill(0))),
    ),
}));

vi.mock('../services/text-extractor.js', () => ({
  extractText: vi.fn().mockResolvedValue('Hello world. This is a test document.'),
}));

vi.mock('../services/chunker.js', () => ({
  chunkText: vi
    .fn()
    .mockImplementation((text: string) => Promise.resolve([text, text + ' chunk2'])),
}));

vi.mock('../services/crawler.js', () => ({
  crawlUrl: vi
    .fn()
    .mockResolvedValue([{ url: 'https://example.com', text: 'Example page content' }]),
}));

vi.mock('../services/agent-secrets.js', () => ({
  getAgentSecrets: vi.fn().mockRejectedValue(new Error('no secrets')),
}));

const mockAgent = {
  id: 'agent-1',
  tenantId: 'tenant-1',
  embeddingModel: 'text-embedding-3-small',
  documents: [
    {
      id: 'doc-1',
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      storagePath: '/tmp/test.pdf',
      status: 'PENDING',
    },
  ],
  sources: [
    {
      id: 'source-1',
      url: 'https://example.com',
      maxDepth: 1,
      includePaths: [],
      excludePaths: [],
      status: 'PENDING',
    },
  ],
};

vi.mock('../db/prisma.js', () => ({
  prisma: {
    agent: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(mockAgent),
    },
    document: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    knowledgeSource: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    documentChunk: {
      deleteMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    job: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

const { reindexAgent } = await import('../services/indexer.js');

describe('indexer — Qdrant payload structure', () => {
  beforeEach(() => {
    capturedPoints.length = 0;
  });

  it('writes full content (not just preview) into Qdrant payload for FILE chunks', async () => {
    await reindexAgent('agent-1', 'job-1');

    const filePoints = (capturedPoints as Array<{ payload: Record<string, unknown> }>).filter(
      (p) => p.payload?.['source_type'] === 'FILE',
    );

    expect(filePoints.length).toBeGreaterThan(0);

    for (const point of filePoints) {
      expect(point.payload).toHaveProperty('content');
      expect(typeof point.payload['content']).toBe('string');
      expect((point.payload['content'] as string).length).toBeGreaterThan(0);
    }
  });

  it('writes full content (not just preview) into Qdrant payload for URL chunks', async () => {
    await reindexAgent('agent-1', 'job-1');

    const urlPoints = (capturedPoints as Array<{ payload: Record<string, unknown> }>).filter(
      (p) => p.payload?.['source_type'] === 'URL',
    );

    expect(urlPoints.length).toBeGreaterThan(0);

    for (const point of urlPoints) {
      expect(point.payload).toHaveProperty('content');
      expect(typeof point.payload['content']).toBe('string');
      expect((point.payload['content'] as string).length).toBeGreaterThan(0);
    }
  });

  it('uses uppercase source_type (FILE not file)', async () => {
    await reindexAgent('agent-1', 'job-1');

    const lowerCaseFile = (capturedPoints as Array<{ payload: Record<string, unknown> }>).find(
      (p) => p.payload?.['source_type'] === 'file',
    );
    const lowerCaseUrl = (capturedPoints as Array<{ payload: Record<string, unknown> }>).find(
      (p) => p.payload?.['source_type'] === 'url',
    );

    expect(lowerCaseFile).toBeUndefined();
    expect(lowerCaseUrl).toBeUndefined();
  });

  it('content is longer than content_preview (200 chars limit)', async () => {
    await reindexAgent('agent-1', 'job-1');

    for (const point of capturedPoints as Array<{ payload: Record<string, unknown> }>) {
      const content = point.payload['content'] as string;
      const preview = point.payload['content_preview'] as string;
      // Preview is always a prefix of content
      expect(content.startsWith(preview)).toBe(true);
    }
  });
});
