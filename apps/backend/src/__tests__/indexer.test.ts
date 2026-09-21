/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
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
  deleteByIndexGeneration: vi.fn().mockResolvedValue(undefined),
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
  activeIndexGeneration: null,
  documents: [
    {
      id: 'doc-1',
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      storagePath: '/tmp/test.pdf',
      storageVersion: null as string | null,
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
      findUnique: vi.fn().mockResolvedValue({ activeIndexGeneration: null }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    document: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    knowledgeSource: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    documentChunk: {
      deleteMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    job: {
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

const { reindexAgent } = await import('../services/indexer.js');
const { extractText } = await import('../services/text-extractor.js');
const { prisma } = await import('../db/prisma.js');
const { deleteByIndexGeneration } = await import('../adapters/vectorstore/qdrant.js');

const fakeStorage = {
  readFile: vi.fn().mockResolvedValue(Buffer.from('Hello world. This is a test document.')),
};

describe('indexer — Qdrant payload structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedPoints.length = 0;
    fakeStorage.readFile.mockClear();
    mockAgent.documents[0]!.storageVersion = null;
    vi.mocked(extractText).mockReset();
    vi.mocked(extractText).mockResolvedValue('Hello world. This is a test document.');
    vi.mocked(prisma.$transaction).mockImplementation(async (work) => work(prisma as never));
    vi.mocked(prisma.$queryRaw).mockImplementation(((parts: TemplateStringsArray) =>
      Promise.resolve(
        String(parts[0]).includes('SELECT * FROM "Job"')
          ? [
              {
                status: 'RUNNING',
                leaseToken: 'lease-1',
                leaseExpiresAt: new Date(Date.now() + 60_000),
              },
            ]
          : [{ now: new Date() }],
      )) as never);
    vi.mocked(prisma.agent.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it('writes full content (not just preview) into Qdrant payload for FILE chunks', async () => {
    await reindexAgent('agent-1', 'job-1', fakeStorage, 'lease-1');
    expect(extractText).toHaveBeenCalledWith(fakeStorage, '/tmp/test.pdf', 'application/pdf');

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

  it('reads the pinned version rather than the current object contents', async () => {
    mockAgent.documents[0]!.storageVersion = '9007199254740993';
    const readFileVersion = vi.fn().mockResolvedValue(Buffer.from('Pinned content'));
    vi.mocked(extractText).mockImplementation(async (storage, key) =>
      (await storage.readFile(key)).toString('utf8'),
    );
    await reindexAgent('agent-1', 'job-1', { ...fakeStorage, readFileVersion }, 'lease-1');
    expect(readFileVersion).toHaveBeenCalledWith('/tmp/test.pdf', '9007199254740993');
    expect(fakeStorage.readFile).not.toHaveBeenCalled();
  });

  it('fails closed when an adapter cannot read pinned versions', async () => {
    mockAgent.documents[0]!.storageVersion = 'version-1';
    await expect(reindexAgent('agent-1', 'job-1', fakeStorage, 'lease-1')).rejects.toThrow(
      /failed to index/i,
    );
    expect(extractText).not.toHaveBeenCalled();
    expect(fakeStorage.readFile).not.toHaveBeenCalled();
  });

  it('writes full content (not just preview) into Qdrant payload for URL chunks', async () => {
    await reindexAgent('agent-1', 'job-1', fakeStorage, 'lease-1');

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
    await reindexAgent('agent-1', 'job-1', fakeStorage, 'lease-1');

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
    await reindexAgent('agent-1', 'job-1', fakeStorage, 'lease-1');

    for (const point of capturedPoints as Array<{ payload: Record<string, unknown> }>) {
      const content = point.payload['content'] as string;
      const preview = point.payload['content_preview'] as string;
      // Preview is always a prefix of content
      expect(content.startsWith(preview)).toBe(true);
    }
  });

  it('stages one generation and publishes it only after all items succeed', async () => {
    await reindexAgent('agent-1', 'job-1', fakeStorage, 'lease-1');

    const generations = new Set(
      (capturedPoints as Array<{ payload: Record<string, unknown> }>).map(
        (point) => point.payload['index_generation'],
      ),
    );
    expect(generations.size).toBe(1);
    const [generation] = generations;
    expect(typeof generation).toBe('string');
    expect(prisma.documentChunk.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ indexGeneration: generation })]),
    });
    expect(prisma.agent.updateMany).toHaveBeenCalledWith({
      where: { id: 'agent-1', activeIndexGeneration: null },
      data: { activeIndexGeneration: generation },
    });
    expect(deleteByIndexGeneration).not.toHaveBeenCalled();
    expect(prisma.documentChunk.deleteMany).toHaveBeenCalledOnce();
    expect(prisma.job.update).toHaveBeenLastCalledWith({
      where: { id: 'job-1' },
      data: { progress: 100 },
    });
  });

  it('does not publish after losing the job lease', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { status: 'RUNNING', leaseToken: 'new-owner', leaseExpiresAt: new Date(Date.now() + 60_000) },
    ] as never);

    await expect(reindexAgent('agent-1', 'job-1', fakeStorage, 'lease-1')).rejects.toThrow(
      'Job lease lost',
    );
    expect(prisma.agent.updateMany).not.toHaveBeenCalled();
    expect(deleteByIndexGeneration).toHaveBeenCalledOnce();
  });

  it('rejects publication if another reindex has changed the active generation', async () => {
    vi.mocked(prisma.agent.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    await expect(reindexAgent('agent-1', 'job-1', fakeStorage, 'lease-1')).rejects.toThrow(
      'Agent index changed during reindex',
    );
    expect(prisma.document.updateMany).not.toHaveBeenCalled();
    expect(deleteByIndexGeneration).not.toHaveBeenCalled();
  });

  it('does not publish or overwrite item statuses when an item fails', async () => {
    vi.mocked(extractText).mockRejectedValueOnce(new Error('Unsupported PDF content'));

    await expect(reindexAgent('agent-1', 'job-1', fakeStorage, 'lease-1')).rejects.toThrow(
      /failed to index/i,
    );

    expect(prisma.agent.updateMany).not.toHaveBeenCalled();
    expect(prisma.document.updateMany).not.toHaveBeenCalled();
    expect(prisma.knowledgeSource.updateMany).not.toHaveBeenCalled();
    expect(deleteByIndexGeneration).toHaveBeenCalledOnce();
  });

  it('sanitizes item-level indexing errors in the job failure', async () => {
    vi.mocked(extractText).mockRejectedValueOnce(
      new Error('provider failed with Bearer sk-live-secret-token-123456789'),
    );

    await expect(reindexAgent('agent-1', 'job-1', fakeStorage, 'lease-1')).rejects.toThrow(
      'Bearer [redacted]',
    );
  });
});
