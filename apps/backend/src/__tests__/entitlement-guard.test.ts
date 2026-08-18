/* eslint-disable @typescript-eslint/unbound-method */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    APP_EDITION: 'pro',
    ENTITLEMENT_PROVIDER: 'community',
    ENTITLEMENT_POLICY_VERSION: 'test-policy',
  },
}));

import Fastify, { type FastifyError } from 'fastify';
import jwt from '@fastify/jwt';
import authPlugin from '../plugins/auth.js';
import dependenciesPlugin from '../plugins/dependencies.js';
import entitlementsPlugin from '../plugins/entitlements.js';
import { serializeApiError, isApiError } from '../services/api-errors.js';
import {
  CommunityEntitlementProvider,
  setEntitlementProviderForTests,
} from '../services/entitlements.js';

async function buildGuardServer(plan: 'lite' | 'pro') {
  setEntitlementProviderForTests(new CommunityEntitlementProvider(plan));
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: 'test-secret-at-least-32-characters-long!!' });
  await app.register(authPlugin);
  await app.register(dependenciesPlugin);
  await app.register(entitlementsPlugin);
  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (isApiError(error)) {
      void reply.status(error.statusCode).send(serializeApiError(error, req.id));
      return;
    }
    void reply.status(500).send({ error: 'Internal Server Error' });
  });
  app.get('/bootstrap', { preHandler: [app.authenticate] }, async (req) =>
    app.getEntitlements(req),
  );
  app.post(
    '/operator-only',
    { preHandler: [app.authenticate, app.requireFeature('operator.inbox')] },
    async () => ({ ok: true }),
  );
  return app;
}

function token(app: Awaited<ReturnType<typeof buildGuardServer>>, tenantId: string) {
  return app.jwt.sign({ sub: 'user-1', email: 'a@b.com', tenantId, role: 'OWNER' });
}

describe('entitlement backend guard', () => {
  afterEach(() => setEntitlementProviderForTests(null));

  it('returns bootstrap snapshot for the authenticated workspace', async () => {
    const app = await buildGuardServer('pro');
    const res = await app.inject({
      method: 'GET',
      url: '/bootstrap',
      headers: { Authorization: `Bearer ${token(app, 'tenant-1')}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      tenantId: 'tenant-1',
      plan: 'PRO',
      features: { 'operator.inbox': { enabled: true } },
    });
    await app.close();
  }, 15_000);

  it('uses the typed error contract for direct Lite API bypass attempts', async () => {
    const app = await buildGuardServer('lite');
    const res = await app.inject({
      method: 'POST',
      url: '/operator-only',
      headers: { Authorization: `Bearer ${token(app, 'tenant-lite')}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: {
        code: 'FEATURE_NOT_AVAILABLE',
        message: 'This feature is not available for the current workspace.',
        details: { feature: 'operator.inbox', tenantId: 'tenant-lite', plan: 'Lite' },
      },
    });
    const body: unknown = res.json();
    expect(
      typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof body.error === 'object' &&
        body.error !== null &&
        'requestId' in body.error &&
        typeof body.error.requestId === 'string' &&
        body.error.requestId.length > 0,
    ).toBe(true);
    await app.close();
  });
});
