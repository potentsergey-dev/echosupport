import Fastify, { type FastifyError } from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import authPlugin from '../plugins/auth.js';
import dependenciesPlugin from '../plugins/dependencies.js';
import entitlementsPlugin from '../plugins/entitlements.js';
import agentRoutes from '../routes/admin/agents.js';
import { isApiError, serializeApiError } from '../services/api-errors.js';
import { createCommunityDependencies } from '../services/dependencies.js';
import {
  CloudEntitlementProvider,
  createEntitlementService,
  DevTenantPlansSubscriptionRepository,
} from '../services/entitlements.js';

const JWT_SECRET = 'integration-jwt-secret-at-least-32-characters';

async function buildTestServer(tenantId: string) {
  const app = Fastify({ logger: false });
  const deps = createCommunityDependencies();
  deps.entitlements = createEntitlementService(
    new CloudEntitlementProvider(new DevTenantPlansSubscriptionRepository(`${tenantId}=Lite`)),
  );

  await app.register(jwt, { secret: JWT_SECRET });
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

describe('agent quota concurrency (PostgreSQL)', () => {
  afterAll(async () => {
    await prisma.tenant.deleteMany();
    await prisma.$disconnect();
  });

  it('allows exactly one parallel agent creation for a Lite tenant', async () => {
    await prisma.tenant.deleteMany();
    const tenant = await prisma.tenant.create({ data: { name: 'Quota Race Tenant' } });
    const app = await buildTestServer(tenant.id);
    const token = app.jwt.sign({
      sub: 'owner-quota',
      email: 'owner-quota@example.com',
      tenantId: tenant.id,
      role: 'OWNER',
    });

    const createAgent = (name: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/admin/agents',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          name,
          systemPrompt: 'Answer with tenant-scoped knowledge only.',
          bookingEnabled: false,
        },
      });

    const results = await Promise.all([createAgent('Lite Agent A'), createAgent('Lite Agent B')]);
    const statusCodes = results.map((res) => res.statusCode).sort((a, b) => a - b);

    expect(statusCodes).toEqual([201, 429]);
    const denied = results.find((res) => res.statusCode === 429);
    expect(denied?.json()).toMatchObject({
      error: { code: 'QUOTA_EXCEEDED', details: { quota: 'agents' } },
    });
    await expect(prisma.agent.count({ where: { tenantId: tenant.id } })).resolves.toBe(1);

    await app.close();
  });
});
