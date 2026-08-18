/* eslint-disable @typescript-eslint/unbound-method */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    MASTER_ENCRYPTION_KEY: 'a'.repeat(64),
    NODE_ENV: 'test',
    PORT: 3000,
    HOST: '0.0.0.0',
    DATABASE_URL: 'postgresql://test',
    JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
    ADMIN_CORS_ORIGINS: '',
    UPLOADS_DIR: './uploads-test-runtime-entitlements',
    APP_URL: 'http://localhost:3000',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    OPENAI_API_KEY: '',
    QDRANT_URL: 'http://localhost:6333',
    MAX_DOCUMENT_SIZE_MB: 50,
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENROUTER_API_KEY: '',
    OPENROUTER_EMBEDDING_API_KEY: '',
    DEEPGRAM_API_KEY: '',
    CRON_SECRET: 'a-very-long-cron-secret-that-is-at-least-32-chars',
  },
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    $disconnect: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    session: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../adapters/vectorstore/qdrant.js', () => ({
  checkQdrantConnection: vi.fn(),
  deleteByAgentId: vi.fn(),
  deleteByDocumentId: vi.fn(),
  deleteBySourceId: vi.fn(),
  ensureCollection: vi.fn(),
  upsertPoints: vi.fn(),
}));

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDependencies } from '../services/dependencies.js';
import { buildServer } from '../server.js';
import {
  CloudEntitlementProvider,
  CommunityEntitlementProvider,
  createEntitlementService,
  DevTenantPlansSubscriptionRepository,
  setEntitlementProviderForTests,
} from '../services/entitlements.js';
import { prisma } from '../db/prisma.js';

function makeDependencies(planMap: string): AppDependencies {
  return {
    storage: {
      saveFile: vi.fn(),
      readFile: vi.fn().mockResolvedValue(Buffer.from('document')),
      deleteFile: vi.fn(),
    },
    jobs: {
      enqueue: vi.fn().mockResolvedValue({ id: 'job-1' }),
    },
    realtime: {
      registerOperator: vi.fn(),
      unregisterOperator: vi.fn(),
      registerVisitor: vi.fn(),
      unregisterVisitor: vi.fn(),
      publishToOperators: vi.fn(),
      publishToVisitor: vi.fn(),
    },
    authWorkspace: {
      async authenticateRequest(request: FastifyRequest) {
        await request.jwtVerify();
        return {
          userId: request.user.sub,
          email: request.user.email,
          tenantId: request.user.tenantId,
          role: request.user.role as 'OWNER' | 'ADMIN' | 'OPERATOR',
        };
      },
      async assertWorkspaceAccess() {
        return undefined;
      },
    },
    entitlements: createEntitlementService(
      new CloudEntitlementProvider(new DevTenantPlansSubscriptionRepository(planMap)),
    ),
    metering: {
      record: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function token(app: FastifyInstance, tenantId: string) {
  return app.jwt.sign({
    sub: `user-${tenantId}`,
    email: `${tenantId}@example.com`,
    tenantId,
    role: 'OWNER',
  });
}

describe('runtime entitlement injection', () => {
  afterEach(() => {
    setEntitlementProviderForTests(null);
    vi.clearAllMocks();
  });

  it('uses injected Cloud Lite entitlements in buildServer even when the global default is PRO', async () => {
    setEntitlementProviderForTests(new CommunityEntitlementProvider('pro'));
    const app = await buildServer({
      startBackgroundWorkers: false,
      dependencies: makeDependencies('tenant-lite=Lite,tenant-pro=PRO'),
    });

    const liteToken = token(app, 'tenant-lite');
    const bootstrap = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/bootstrap',
      headers: { Authorization: `Bearer ${liteToken}` },
    });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      plan: 'Lite',
      features: { 'operator.inbox': false, 'booking.workflow': false },
    });

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/inbox',
      headers: { Authorization: `Bearer ${liteToken}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error: { code: 'FEATURE_NOT_AVAILABLE', details: { feature: 'operator.inbox' } },
    });
    expect(prisma.session.findMany).not.toHaveBeenCalled();

    const proBootstrap = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/bootstrap',
      headers: { Authorization: `Bearer ${token(app, 'tenant-pro')}` },
    });
    expect(proBootstrap.statusCode).toBe(200);
    expect(proBootstrap.json()).toMatchObject({
      plan: 'PRO',
      features: { 'operator.inbox': true, 'booking.workflow': true },
    });

    await app.close();
  });

  it('allows real PRO routes with the injected PRO tenant snapshot', async () => {
    const app = await buildServer({
      startBackgroundWorkers: false,
      dependencies: makeDependencies('tenant-pro=PRO'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/inbox',
      headers: { Authorization: `Bearer ${token(app, 'tenant-pro')}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(prisma.session.findMany).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
