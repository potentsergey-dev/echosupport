/* eslint-disable @typescript-eslint/unbound-method */
import Fastify, { type FastifyError } from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    MASTER_ENCRYPTION_KEY: 'a'.repeat(64),
    NODE_ENV: 'test',
    UPLOADS_DIR: './uploads-test',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    APP_URL: 'http://localhost:3000',
    OPENAI_API_KEY: '',
    OPENROUTER_API_KEY: '',
    OPENROUTER_EMBEDDING_API_KEY: '',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    DEEPGRAM_API_KEY: '',
    QDRANT_URL: 'http://localhost:6333',
    MAX_DOCUMENT_SIZE_MB: 50,
  },
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    agent: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../adapters/vectorstore/qdrant.js', () => ({
  checkQdrantConnection: vi.fn(),
}));

import agentRoutes from '../routes/admin/agents.js';
import authPlugin from '../plugins/auth.js';
import dependenciesPlugin from '../plugins/dependencies.js';
import entitlementsPlugin from '../plugins/entitlements.js';
import { isApiError, serializeApiError } from '../services/api-errors.js';
import { createCommunityDependencies } from '../services/dependencies.js';
import {
  CloudEntitlementProvider,
  createEntitlementService,
  DevTenantPlansSubscriptionRepository,
} from '../services/entitlements.js';
import { prisma } from '../db/prisma.js';

async function buildLiteServer() {
  const app = Fastify({ logger: false });
  const deps = createCommunityDependencies();
  deps.entitlements = createEntitlementService(
    new CloudEntitlementProvider(new DevTenantPlansSubscriptionRepository('tenant-lite=Lite')),
  );

  await app.register(jwt, { secret: 'test-secret-at-least-32-characters-long!!' });
  await app.register(multipart);
  await app.register(dependenciesPlugin, { dependencies: deps });
  await app.register(authPlugin);
  await app.register(entitlementsPlugin);
  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (isApiError(error)) {
      void reply.status(error.statusCode).send(serializeApiError(error, req.id));
      return;
    }
    void reply.status(error.statusCode ?? 500).send({ error: error.message });
  });
  await app.register(agentRoutes, { prefix: '/api/v1/admin' });
  return app;
}

describe('agent secret entitlement gates', () => {
  afterEach(() => vi.clearAllMocks());

  it('lets Lite tenants save a dedicated OpenAI embeddings key without voice.stt', async () => {
    const app = await buildLiteServer();
    vi.mocked(prisma.agent.findFirst).mockResolvedValueOnce({
      id: 'agent-1',
      encryptedSecrets: {},
    } as never);
    vi.mocked(prisma.agent.update).mockResolvedValueOnce({} as never);
    const token = app.jwt.sign({
      sub: 'user-1',
      email: 'owner@example.com',
      tenantId: 'tenant-lite',
      role: 'OWNER',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/agents/agent-1/secrets',
      headers: { Authorization: `Bearer ${token}` },
      payload: { openaiEmbeddingKey: 'sk-embedding-lite' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('openaiEmbeddingKey');
    expect(prisma.agent.update).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('keeps direct OpenAI/Whisper key gated by voice.stt for Lite tenants', async () => {
    const app = await buildLiteServer();
    vi.mocked(prisma.agent.findFirst).mockResolvedValueOnce({
      id: 'agent-1',
      encryptedSecrets: {},
    } as never);
    const token = app.jwt.sign({
      sub: 'user-1',
      email: 'owner@example.com',
      tenantId: 'tenant-lite',
      role: 'OWNER',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/agents/agent-1/secrets',
      headers: { Authorization: `Bearer ${token}` },
      payload: { openaiKey: 'sk-whisper-pro' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: 'FEATURE_NOT_AVAILABLE', details: { feature: 'voice.stt' } },
    });
    expect(prisma.agent.update).not.toHaveBeenCalled();
    await app.close();
  });
});
