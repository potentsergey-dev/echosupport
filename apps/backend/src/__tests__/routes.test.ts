/* eslint-disable @typescript-eslint/unbound-method */
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
    OPENAI_API_KEY: '',
    QDRANT_URL: 'http://localhost:6333',
    MAX_DOCUMENT_SIZE_MB: 50,
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENROUTER_API_KEY: '',
    DEEPGRAM_API_KEY: '',
    CRON_SECRET: 'a-very-long-cron-secret-that-is-at-least-32-chars',
  },
}));

vi.mock('../adapters/storage/local-fs.js', () => ({
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('../adapters/vectorstore/qdrant.js', () => ({
  deleteByDocumentId: vi.fn(),
  deleteBySourceId: vi.fn(),
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    job: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    agent: {
      findFirst: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    documentChunk: {
      deleteMany: vi.fn(),
    },
    knowledgeSource: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    session: {
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
    },
  },
}));

import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import authPlugin from '../plugins/auth.js';
import jobRoutes from '../routes/admin/jobs.js';
import documentRoutes from '../routes/admin/documents.js';
import internalCronRoutes from '../routes/internal/cron.js';
import { prisma } from '../db/prisma.js';

async function buildTestServer() {
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: 'test-secret-at-least-32-characters-long!!' });
  await app.register(authPlugin);
  await app.register(jobRoutes, { prefix: '/api/v1/admin' });
  await app.register(documentRoutes, { prefix: '/api/v1/admin' });
  await app.register(internalCronRoutes, { prefix: '/api/v1/internal' });
  return app;
}

function signToken(app: Awaited<ReturnType<typeof buildTestServer>>) {
  return app.jwt.sign({ sub: 'user-1', email: 'a@b.com', tenantId: 'tenant-1', role: 'OWNER' });
}

describe('auth — authenticateQueryToken (SSE fallback)', () => {
  it('accepts JWT from Authorization header on SSE stream endpoint', async () => {
    const app = await buildTestServer();
    vi.mocked(prisma.job.findUnique).mockResolvedValueOnce({
      id: 'job-1',
      agentId: 'agent-1',
      type: 'REINDEX_AGENT',
      status: 'DONE',
      progress: 100,
      errorMessage: null,
      payload: {},
      scheduledAt: new Date(),
      startedAt: null,
      finishedAt: null,
    } as never);
    vi.mocked(prisma.agent.findFirst).mockResolvedValueOnce({ id: 'agent-1' } as never);

    const token = signToken(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/jobs/job-1/stream',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).not.toBe(401);
    await app.close();
  });

  it('accepts JWT from ?token= query param on SSE stream endpoint', async () => {
    const app = await buildTestServer();
    vi.mocked(prisma.job.findUnique).mockResolvedValueOnce({
      id: 'job-1',
      agentId: 'agent-1',
      type: 'REINDEX_AGENT',
      status: 'DONE',
      progress: 100,
      errorMessage: null,
      payload: {},
      scheduledAt: new Date(),
      startedAt: null,
      finishedAt: null,
    } as never);
    vi.mocked(prisma.agent.findFirst).mockResolvedValueOnce({ id: 'agent-1' } as never);

    const token = signToken(app);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/jobs/job-1/stream?token=${encodeURIComponent(token)}`,
    });

    // Should NOT return 401 (stream or 404 for job are both valid non-auth outcomes)
    expect(res.statusCode).not.toBe(401);
    await app.close();
  });

  it('rejects unauthenticated SSE stream (no token at all)', async () => {
    const app = await buildTestServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/jobs/some-id/stream',
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('jobs — tenant isolation', () => {
  it('returns 404 when job belongs to another tenant', async () => {
    const app = await buildTestServer();

    vi.mocked(prisma.job.findUnique).mockResolvedValueOnce({
      id: 'job-1',
      agentId: 'agent-other-tenant',
      type: 'REINDEX_AGENT',
      status: 'DONE',
      progress: 100,
      errorMessage: null,
      payload: {},
      scheduledAt: new Date(),
      startedAt: null,
      finishedAt: null,
    } as never);
    // Agent belongs to a DIFFERENT tenant — findFirst returns null
    vi.mocked(prisma.agent.findFirst).mockResolvedValueOnce(null);

    const token = signToken(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/jobs/job-1',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns job data when job belongs to the current tenant', async () => {
    const app = await buildTestServer();

    vi.mocked(prisma.job.findUnique).mockResolvedValueOnce({
      id: 'job-1',
      agentId: 'agent-1',
      type: 'REINDEX_AGENT',
      status: 'DONE',
      progress: 100,
      errorMessage: null,
      payload: {},
      scheduledAt: new Date(),
      startedAt: null,
      finishedAt: null,
    } as never);
    vi.mocked(prisma.agent.findFirst).mockResolvedValueOnce({ id: 'agent-1' } as never);

    const token = signToken(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/jobs/job-1',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; status: string }>();
    expect(body.id).toBe('job-1');
    await app.close();
  });

  it('returns 404 for system jobs without agentId', async () => {
    const app = await buildTestServer();

    vi.mocked(prisma.job.findUnique).mockResolvedValueOnce({
      id: 'job-sys',
      agentId: null,
      type: 'CLEANUP_SESSIONS',
      status: 'DONE',
      progress: 100,
      errorMessage: null,
      payload: {},
      scheduledAt: new Date(),
      startedAt: null,
      finishedAt: null,
    } as never);

    const token = signToken(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/jobs/job-sys',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('knowledge routes — indexing boundaries', () => {
  it('rejects reindexing before any files or website sources exist', async () => {
    const app = await buildTestServer();

    vi.mocked(prisma.agent.findFirst).mockResolvedValueOnce({ id: 'agent-1' } as never);
    vi.mocked(prisma.document.count).mockResolvedValueOnce(0);
    vi.mocked(prisma.knowledgeSource.count).mockResolvedValueOnce(0);

    const token = signToken(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/agents/agent-1/reindex',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toMatch(/add at least one/i);
    expect(prisma.job.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('creates a reindex job when knowledge exists', async () => {
    const app = await buildTestServer();

    vi.mocked(prisma.agent.findFirst).mockResolvedValueOnce({ id: 'agent-1' } as never);
    vi.mocked(prisma.document.count).mockResolvedValueOnce(1);
    vi.mocked(prisma.knowledgeSource.count).mockResolvedValueOnce(0);
    vi.mocked(prisma.job.create).mockResolvedValueOnce({ id: 'job-1' } as never);

    const token = signToken(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/agents/agent-1/reindex',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json<{ jobId: string }>().jobId).toBe('job-1');
    await app.close();
  });

  it('rejects private localhost website sources', async () => {
    const app = await buildTestServer();

    vi.mocked(prisma.agent.findFirst).mockResolvedValueOnce({ id: 'agent-1' } as never);

    const token = signToken(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/agents/agent-1/sources',
      headers: { Authorization: `Bearer ${token}` },
      payload: { url: 'http://localhost:3000/docs', maxDepth: 1 },
    });

    expect(res.statusCode).toBe(400);
    expect(prisma.knowledgeSource.create).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('internal cron — cleanup endpoint', () => {
  it('rejects request without CRON_SECRET', async () => {
    const app = await buildTestServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/cron/cleanup',
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects wrong secret', async () => {
    const app = await buildTestServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/cron/cleanup',
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns deleted count with correct secret', async () => {
    const app = await buildTestServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/internal/cron/cleanup',
      headers: {
        Authorization: 'Bearer a-very-long-cron-secret-that-is-at-least-32-chars',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; deleted: number }>();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(3);
    await app.close();
  });
});
