import Fastify, { type FastifyError } from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { hash } from 'bcryptjs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import authPlugin from '../plugins/auth.js';
import authRoutes from '../routes/auth/login.js';
import agentRoutes from '../routes/admin/agents.js';
import documentRoutes from '../routes/admin/documents.js';
import adminSessionRoutes from '../routes/admin/sessions.js';
import operatorRoutes from '../routes/operator/index.js';
import publicSessionRoutes from '../routes/public/sessions.js';
import { isAdminOriginAllowed } from '../services/origin-policy.js';

const JWT_SECRET = 'integration-jwt-secret-at-least-32-characters';
const TRUSTED_ORIGIN = 'https://admin.example';

interface Fixture {
  tenantA: string;
  tenantB: string;
  ownerA: string;
  adminA: string;
  operatorA: string;
  agentA: string;
  agentB: string;
  agentAKey: string;
  agentBKey: string;
  documentA: string;
  documentB: string;
  sessionA: string;
  sessionB: string;
}

async function buildTestServer() {
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: JWT_SECRET });
  await app.register(multipart);
  await app.register(authPlugin);

  app.addHook('onRequest', async (request, reply) => {
    const protectedBrowserRoute = ['/api/v1/auth/', '/api/v1/admin/', '/api/v1/operator/'].some(
      (prefix) => request.url.startsWith(prefix),
    );
    if (protectedBrowserRoute && !isAdminOriginAllowed(request.headers.origin, TRUSTED_ORIGIN)) {
      return reply.status(403).send({ error: 'Origin not allowed' });
    }
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    void reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
    });
  });
  app.get('/__test/internal-error', async () => {
    throw new Error('postgresql://private-user:private-password@database/internal');
  });

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(agentRoutes, { prefix: '/api/v1/admin' });
  await app.register(documentRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminSessionRoutes, { prefix: '/api/v1/admin' });
  await app.register(operatorRoutes, { prefix: '/api/v1/operator' });
  await app.register(publicSessionRoutes, { prefix: '/api/v1/public' });
  return app;
}

async function seedFixture(): Promise<Fixture> {
  await prisma.tenant.deleteMany();

  const passwordHash = await hash('correct horse battery staple', 4);
  const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A' } });
  const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B' } });
  const [ownerA, adminA, operatorA] = await Promise.all([
    prisma.user.create({
      data: { tenantId: tenantA.id, email: 'owner-a@example.com', passwordHash, role: 'OWNER' },
    }),
    prisma.user.create({
      data: { tenantId: tenantA.id, email: 'admin-a@example.com', passwordHash, role: 'ADMIN' },
    }),
    prisma.user.create({
      data: {
        tenantId: tenantA.id,
        email: 'operator-a@example.com',
        passwordHash,
        role: 'OPERATOR',
      },
    }),
  ]);
  const [agentA, agentB] = await Promise.all([
    prisma.agent.create({
      data: {
        tenantId: tenantA.id,
        name: 'Agent A',
        systemPrompt: 'Tenant A only',
        publicKey: 'pk_integration_tenant_a',
        allowedOrigins: ['https://widget-a.example'],
        encryptedSecrets: { openrouterKey: 'must-never-leak' },
      },
    }),
    prisma.agent.create({
      data: {
        tenantId: tenantB.id,
        name: 'Agent B',
        systemPrompt: 'Tenant B only',
        publicKey: 'pk_integration_tenant_b',
        allowedOrigins: ['https://widget-b.example'],
      },
    }),
  ]);
  const [documentA, documentB] = await Promise.all([
    prisma.document.create({
      data: {
        agentId: agentA.id,
        filename: 'a.txt',
        mimeType: 'text/plain',
        sizeBytes: 1,
        storagePath: '/private/a.txt',
      },
    }),
    prisma.document.create({
      data: {
        agentId: agentB.id,
        filename: 'b.txt',
        mimeType: 'text/plain',
        sizeBytes: 1,
        storagePath: '/private/b.txt',
      },
    }),
  ]);
  const expiresAt = new Date(Date.now() + 60_000);
  const [sessionA, sessionB] = await Promise.all([
    prisma.session.create({
      data: { agentId: agentA.id, visitorId: 'visitor-a', expiresAt },
    }),
    prisma.session.create({
      data: { agentId: agentB.id, visitorId: 'visitor-b', expiresAt },
    }),
  ]);
  await prisma.message.create({
    data: {
      sessionId: sessionA.id,
      role: 'USER',
      authorType: 'VISITOR',
      content: 'Hello from visitor A',
    },
  });

  return {
    tenantA: tenantA.id,
    tenantB: tenantB.id,
    ownerA: ownerA.id,
    adminA: adminA.id,
    operatorA: operatorA.id,
    agentA: agentA.id,
    agentB: agentB.id,
    agentAKey: agentA.publicKey,
    agentBKey: agentB.publicKey,
    documentA: documentA.id,
    documentB: documentB.id,
    sessionA: sessionA.id,
    sessionB: sessionB.id,
  };
}

function token(
  app: Awaited<ReturnType<typeof buildTestServer>>,
  fixture: Fixture,
  role: 'OWNER' | 'ADMIN' | 'OPERATOR',
  expiresIn: string | number = '1h',
) {
  const userIds = {
    OWNER: fixture.ownerA,
    ADMIN: fixture.adminA,
    OPERATOR: fixture.operatorA,
  };
  return app.jwt.sign(
    {
      sub: userIds[role],
      email: `${role.toLowerCase()}-a@example.com`,
      tenantId: fixture.tenantA,
      role,
    },
    { expiresIn },
  );
}

function authorization(value: string) {
  return { authorization: `Bearer ${value}` };
}

describe('authentication and tenant isolation (PostgreSQL)', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany();
    await prisma.$disconnect();
  });

  it('accepts valid login and rejects unknown users and incorrect passwords generically', async () => {
    const app = await buildTestServer();
    const success = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner-a@example.com', password: 'correct horse battery staple' },
    });
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner-a@example.com', password: 'wrong' },
    });
    const unknownUser = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'missing@example.com', password: 'wrong' },
    });

    expect(success.statusCode).toBe(200);
    const loginBody = success.json<{
      token: string;
      user: { id: string; email: string; role: string };
    }>();
    expect(loginBody).toMatchObject({
      user: { id: fixture.ownerA, email: 'owner-a@example.com', role: 'OWNER' },
    });
    expect(loginBody.token).toEqual(expect.any(String));
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual({ error: 'Invalid credentials' });
    expect(unknownUser.json()).toEqual({ error: 'Invalid credentials' });
    expect(success.body).not.toContain('passwordHash');
    expect(wrongPassword.body).not.toContain('postgresql://');
    await app.close();
  });

  it('rejects missing, malformed and expired JWTs without internal details', async () => {
    const app = await buildTestServer();
    const requests = [
      {},
      authorization('not-a-jwt'),
      authorization(token(app, fixture, 'OWNER', -1)),
    ];

    for (const headers of requests) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/agents',
        headers,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
      expect(response.body).not.toContain('token');
      expect(response.body).not.toContain('postgresql://');
    }
    await app.close();
  });

  it('does not expose secrets or internal dependency details in server errors', async () => {
    const app = await buildTestServer();
    const response = await app.inject({ method: 'GET', url: '/__test/internal-error' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal Server Error' });
    expect(response.body).not.toContain('private-password');
    expect(response.body).not.toContain('postgresql://');
    await app.close();
  });

  it('enforces OWNER/ADMIN/OPERATOR role boundaries', async () => {
    const app = await buildTestServer();
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/agents',
        headers: authorization(token(app, fixture, role)),
      });
      expect(response.statusCode).toBe(200);
    }
    const operatorAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/agents',
      headers: authorization(token(app, fixture, 'OPERATOR')),
    });
    expect(operatorAdmin.statusCode).toBe(403);
    expect(operatorAdmin.json()).toEqual({ error: 'Forbidden' });

    for (const role of ['OWNER', 'ADMIN', 'OPERATOR'] as const) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/operator/inbox',
        headers: authorization(token(app, fixture, role)),
      });
      expect(response.statusCode).toBe(200);
    }
    await app.close();
  });

  it('isolates agent lists, reads and mutations and never returns encrypted secrets', async () => {
    const app = await buildTestServer();
    const headers = authorization(token(app, fixture, 'OWNER'));
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/agents', headers });
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/agents/${fixture.agentB}`,
      headers,
    });
    const foreignPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/agents/${fixture.agentB}`,
      headers,
      payload: { name: 'Compromised' },
    });

    expect(list.statusCode).toBe(200);
    const agents = list.json<Array<{ id: string }>>();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: fixture.agentA });
    expect(list.body).not.toContain(fixture.agentB);
    expect(list.body).not.toContain('must-never-leak');
    expect(list.body).not.toContain('encryptedSecrets');
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignPatch.statusCode).toBe(404);
    expect(await prisma.agent.findUnique({ where: { id: fixture.agentB } })).toMatchObject({
      name: 'Agent B',
    });
    await app.close();
  });

  it('isolates document and admin-session reads and mutations', async () => {
    const app = await buildTestServer();
    const headers = authorization(token(app, fixture, 'ADMIN'));
    const documents = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/agents/${fixture.agentA}/documents`,
      headers,
    });
    const foreignDocuments = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/agents/${fixture.agentB}/documents`,
      headers,
    });
    const foreignDocumentDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/agents/${fixture.agentA}/documents/${fixture.documentB}`,
      headers,
    });
    const foreignSessions = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/agents/${fixture.agentB}/sessions`,
      headers,
    });
    const foreignSessionDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sessions/${fixture.sessionB}`,
      headers,
    });

    expect(documents.statusCode).toBe(200);
    const documentList = documents.json<Array<{ id: string }>>();
    expect(documentList).toHaveLength(1);
    expect(documentList[0]).toMatchObject({ id: fixture.documentA });
    expect(foreignDocuments.statusCode).toBe(404);
    expect(foreignDocumentDelete.statusCode).toBe(404);
    expect(foreignSessions.statusCode).toBe(404);
    expect(foreignSessionDelete.statusCode).toBe(404);
    expect(await prisma.document.findUnique({ where: { id: fixture.documentB } })).not.toBeNull();
    expect(await prisma.session.findUnique({ where: { id: fixture.sessionB } })).not.toBeNull();
    await app.close();
  });

  it('hides empty widget sessions from operator inbox and take-over', async () => {
    const app = await buildTestServer();
    const headers = authorization(token(app, fixture, 'OPERATOR'));
    const [emptySession, emptyTakenSession] = await Promise.all([
      prisma.session.create({
        data: {
          agentId: fixture.agentA,
          visitorId: 'empty-widget-open',
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
      prisma.session.create({
        data: {
          agentId: fixture.agentA,
          visitorId: 'empty-widget-taken',
          status: 'WITH_OPERATOR',
          assignedOperatorId: fixture.operatorA,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ]);

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/inbox?status=ALL_OPEN',
      headers,
    });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.body).not.toContain(emptySession.id);
    expect(inbox.body).not.toContain(emptyTakenSession.id);

    const take = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/sessions/${emptySession.id}/take`,
      headers,
    });
    expect(take.statusCode).toBe(409);
    expect(take.json()).toEqual({ error: 'Cannot take an empty session' });
    await app.close();
  });
  it('isolates operator inbox, session reads and session mutations', async () => {
    const app = await buildTestServer();
    const headers = authorization(token(app, fixture, 'OPERATOR'));
    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/inbox',
      headers,
    });
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/operator/sessions/${fixture.sessionB}`,
      headers,
    });
    const foreignPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/operator/sessions/${fixture.sessionB}`,
      headers,
      payload: { internalNote: 'cross-tenant write' },
    });

    expect(inbox.statusCode).toBe(200);
    expect(inbox.body).toContain(fixture.sessionA);
    expect(inbox.body).not.toContain(fixture.sessionB);
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignPatch.statusCode).toBe(404);
    expect(await prisma.session.findUnique({ where: { id: fixture.sessionB } })).toMatchObject({
      internalNote: null,
    });
    await app.close();
  });

  it('returns operator inbox fields expected by the admin UI and marks opened sessions read', async () => {
    const app = await buildTestServer();
    const headers = authorization(token(app, fixture, 'OPERATOR'));
    await prisma.session.update({
      where: { id: fixture.sessionA },
      data: {
        status: 'WAITING_OPERATOR',
        visitorName: 'Ada Lovelace',
        visitorContact: 'ada@example.com',
        pageUrl: 'https://widget-a.example/pricing',
        handoffReason: 'Needs billing help',
        handoffRequestedAt: new Date('2026-07-08T10:00:00.000Z'),
        internalNote: 'VIP lead',
        unreadByOperator: 2,
        tags: ['billing'],
      },
    });

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/inbox?status=WAITING_OPERATOR',
      headers,
    });

    expect(inbox.statusCode).toBe(200);
    const sessions = inbox.json<
      Array<{
        id: string;
        agentName: string;
        visitorContact: string | null;
        handoffRequestedAt: string | null;
        internalNote: string | null;
        createdAt: string;
      }>
    >();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: fixture.sessionA,
      agentName: 'Agent A',
      visitorContact: 'ada@example.com',
      handoffRequestedAt: '2026-07-08T10:00:00.000Z',
      internalNote: 'VIP lead',
    });
    expect(sessions[0]?.createdAt).toEqual(expect.any(String));

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/operator/sessions/${fixture.sessionA}`,
      headers,
    });

    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json<{ agentName: string; createdAt: string }>();
    expect(detailBody.agentName).toBe('Agent A');
    expect(typeof detailBody.createdAt).toBe('string');
    expect(await prisma.session.findUnique({ where: { id: fixture.sessionA } })).toMatchObject({
      unreadByOperator: 0,
    });
    await app.close();
  });

  it('guards operator take, message and resolve mutations by session state', async () => {
    const app = await buildTestServer();
    const headers = authorization(token(app, fixture, 'OPERATOR'));

    const prematureMessage = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/sessions/${fixture.sessionA}/messages`,
      headers,
      payload: { content: 'I can help.' },
    });
    expect(prematureMessage.statusCode).toBe(409);
    expect(prematureMessage.json()).toEqual({
      error: 'Take the session before sending an operator message',
    });

    const take = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/sessions/${fixture.sessionA}/take`,
      headers,
    });
    expect(take.statusCode).toBe(200);
    expect(await prisma.session.findUnique({ where: { id: fixture.sessionA } })).toMatchObject({
      status: 'WITH_OPERATOR',
      assignedOperatorId: fixture.operatorA,
    });

    const message = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/sessions/${fixture.sessionA}/messages`,
      headers,
      payload: { content: '  I can help.  ' },
    });
    expect(message.statusCode).toBe(201);
    expect(
      message.json<{ content: string; authorType: string; isInternal: boolean }>(),
    ).toMatchObject({
      content: 'I can help.',
      authorType: 'OPERATOR',
      isInternal: false,
    });
    expect(await prisma.session.findUnique({ where: { id: fixture.sessionA } })).toMatchObject({
      unreadByVisitor: 1,
    });

    const invalidResolve = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/sessions/${fixture.sessionA}/resolve`,
      headers,
      payload: { internalNote: 123 },
    });
    expect(invalidResolve.statusCode).toBe(400);

    const resolve = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/sessions/${fixture.sessionA}/resolve`,
      headers,
      payload: { tags: ['done'], internalNote: 'Solved in chat' },
    });
    expect(resolve.statusCode).toBe(200);
    expect(await prisma.session.findUnique({ where: { id: fixture.sessionA } })).toMatchObject({
      status: 'RESOLVED',
      tags: ['done'],
      internalNote: 'Solved in chat',
    });

    const messageAfterResolve = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/sessions/${fixture.sessionA}/messages`,
      headers,
      payload: { content: 'Still here?' },
    });
    expect(messageAfterResolve.statusCode).toBe(409);
    await app.close();
  });

  it('prevents an agent public key from modifying another agent session', async () => {
    const app = await buildTestServer();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sessions/${fixture.sessionB}/close`,
      headers: { 'x-agent-key': fixture.agentAKey },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid X-Agent-Key' });
    expect(await prisma.session.findUnique({ where: { id: fixture.sessionB } })).toMatchObject({
      closedAt: null,
    });
    await app.close();
  });

  it('enforces browser origin policy on auth, admin and operator routes', async () => {
    const app = await buildTestServer();
    const ownerToken = token(app, fixture, 'OWNER');
    for (const url of ['/api/v1/auth/login', '/api/v1/admin/agents', '/api/v1/operator/inbox']) {
      const request = {
        method: url.endsWith('login') ? 'POST' : 'GET',
        url,
        headers: { ...authorization(ownerToken), origin: 'https://evil.example' },
      } as const;
      const denied = await app.inject(
        url.endsWith('login')
          ? {
              ...request,
              payload: {
                email: 'owner-a@example.com',
                password: 'correct horse battery staple',
              },
            }
          : request,
      );
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ error: 'Origin not allowed' });
    }

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/agents',
      headers: { ...authorization(ownerToken), origin: TRUSTED_ORIGIN },
    });
    const nonBrowser = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/agents',
      headers: authorization(ownerToken),
    });
    expect(allowed.statusCode).toBe(200);
    expect(nonBrowser.statusCode).toBe(200);
    await app.close();
  });
});
