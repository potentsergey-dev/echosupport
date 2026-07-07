import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import WebSocket, { type RawData } from 'ws';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import wsRoutes from '../routes/ws/index.js';
import {
  getRealtimeConnectionCounts,
  publishToOperators,
  publishToVisitor,
  type HubEvent,
} from '../services/realtime-hub.js';

const JWT_SECRET = 'integration-jwt-secret-at-least-32-characters';
const ADMIN_ORIGIN = 'https://admin.example';
const TIMEOUT_MS = 2_000;

interface Fixture {
  tenantA: string;
  tenantB: string;
  agentAKey: string;
  agentBKey: string;
  sessionA: string;
  sessionB: string;
}

interface TestServer {
  app: FastifyInstance;
  baseUrl: string;
}

const openSockets = new Set<WebSocket>();
let server: TestServer | undefined;
let fixture: Fixture;

function rawDataToString(raw: RawData): string {
  if (raw instanceof Buffer) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw as ArrayBuffer).toString('utf8');
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}`)),
      TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return withTimeout(
    new Promise((resolve, reject) => {
      const onMessage = (raw: RawData) => {
        cleanup();
        try {
          resolve(JSON.parse(rawDataToString(raw)) as Record<string, unknown>);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      const onClose = (code: number, reason: Buffer) => {
        cleanup();
        reject(
          new Error(
            `Socket closed before the expected message (${code}: ${reason.toString('utf8')})`,
          ),
        );
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off('message', onMessage);
        socket.off('close', onClose);
        socket.off('error', onError);
      };
      socket.once('message', onMessage);
      socket.once('close', onClose);
      socket.once('error', onError);
    }),
    'WebSocket message',
  );
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return withTimeout(
    new Promise((resolve, reject) => {
      const cleanup = () => {
        socket.off('open', onOpen);
        socket.off('error', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      socket.once('open', onOpen);
      socket.once('error', onError);
    }),
    'WebSocket open',
  );
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return withTimeout(
    new Promise((resolve) => {
      socket.once('close', (code, reason) => {
        openSockets.delete(socket);
        resolve({ code, reason: reason.toString() });
      });
    }),
    'WebSocket close',
  );
}

function observeClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      openSockets.delete(socket);
      resolve({ code, reason: reason.toString() });
    });
  });
}

async function connect(
  path: string,
  options: { origin?: string } = {},
): Promise<{
  socket: WebSocket;
  connected: Record<string, unknown>;
  closed: Promise<{ code: number; reason: string }>;
}> {
  if (!server) throw new Error('Test server is not running');
  const clientOptions = options.origin ? { headers: { Origin: options.origin } } : {};
  const socket = new WebSocket(`${server.baseUrl}${path}`, clientOptions);
  openSockets.add(socket);
  const connected = nextMessage(socket);
  const closed = observeClose(socket);
  await waitForOpen(socket);
  return { socket, connected: await connected, closed };
}

async function connectUntilClose(
  path: string,
  options: { origin?: string } = {},
): Promise<{ socket: WebSocket; close: { code: number; reason: string } }> {
  if (!server) throw new Error('Test server is not running');
  const clientOptions = options.origin ? { headers: { Origin: options.origin } } : {};
  const socket = new WebSocket(`${server.baseUrl}${path}`, clientOptions);
  openSockets.add(socket);
  const close = observeClose(socket);
  await waitForOpen(socket);
  return { socket, close: await withTimeout(close, 'WebSocket close') };
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    openSockets.delete(socket);
    return;
  }
  if (socket.readyState === WebSocket.CLOSING) {
    await waitForClose(socket);
    return;
  }
  const closed = waitForClose(socket);
  socket.close(1000, 'Test complete');
  await closed;
}

async function buildTestServer() {
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: JWT_SECRET });
  await app.register(websocket);
  await app.register(wsRoutes, { prefix: '/api/v1' });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, baseUrl: address.replace(/^http/, 'ws') };
}

async function seedFixture(): Promise<Fixture> {
  await prisma.tenant.deleteMany();
  const [tenantA, tenantB] = await Promise.all([
    prisma.tenant.create({ data: { name: 'WebSocket Tenant A' } }),
    prisma.tenant.create({ data: { name: 'WebSocket Tenant B' } }),
  ]);
  const [agentA, agentB] = await Promise.all([
    prisma.agent.create({
      data: {
        tenantId: tenantA.id,
        name: 'WebSocket Agent A',
        systemPrompt: 'Tenant A',
        publicKey: 'pk_websocket_tenant_a',
        allowedOrigins: ['https://widget-a.example'],
      },
    }),
    prisma.agent.create({
      data: {
        tenantId: tenantB.id,
        name: 'WebSocket Agent B',
        systemPrompt: 'Tenant B',
        publicKey: 'pk_websocket_tenant_b',
        allowedOrigins: ['https://widget-b.example'],
      },
    }),
  ]);
  const expiresAt = new Date(Date.now() + 60_000);
  const [sessionA, sessionB] = await Promise.all([
    prisma.session.create({ data: { agentId: agentA.id, expiresAt } }),
    prisma.session.create({ data: { agentId: agentB.id, expiresAt } }),
  ]);
  return {
    tenantA: tenantA.id,
    tenantB: tenantB.id,
    agentAKey: agentA.publicKey,
    agentBKey: agentB.publicKey,
    sessionA: sessionA.id,
    sessionB: sessionB.id,
  };
}

function operatorToken(
  role: string,
  tenantId = fixture.tenantA,
  expiresIn: string | number = '1h',
): string {
  if (!server) throw new Error('Test server is not running');
  return server.app.jwt.sign(
    {
      sub: `user-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@example.com`,
      tenantId,
      role,
    },
    { expiresIn },
  );
}

function operatorPath(token?: string): string {
  return token ? `/api/v1/ws/operator?token=${encodeURIComponent(token)}` : '/api/v1/ws/operator';
}

function visitorPath(sessionId?: string, agentKey?: string): string {
  const query = new URLSearchParams();
  if (sessionId) query.set('sessionId', sessionId);
  if (agentKey) query.set('agentKey', agentKey);
  return `/api/v1/ws/visitor?${query.toString()}`;
}

function expectSanitized(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(JWT_SECRET);
  expect(serialized).not.toContain('provider-key');
  expect(serialized).not.toContain('postgresql://');
  expect(serialized).not.toContain('node_modules');
  expect(serialized).not.toContain('at ');
}

describe('WebSocket security and tenant isolation (PostgreSQL)', () => {
  beforeEach(async () => {
    fixture = await seedFixture();
    server = await buildTestServer();
  });

  afterEach(async () => {
    for (const socket of [...openSockets]) {
      await closeSocket(socket);
    }
    await server?.app.close();
    server = undefined;
    expect(getRealtimeConnectionCounts()).toEqual({
      operatorTenants: 0,
      operatorSockets: 0,
      visitorSessions: 0,
      visitorSockets: 0,
    });
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany();
    await prisma.$disconnect();
  });

  it('rejects missing, malformed and expired operator JWTs without leaking details', async () => {
    for (const token of [
      undefined,
      'damaged.jwt.value',
      operatorToken('OWNER', fixture.tenantA, -1),
    ]) {
      const { connected, closed } = await connect(operatorPath(token));

      expect(connected).toEqual({ type: 'error', message: 'Unauthorized' });
      expect(await withTimeout(closed, 'WebSocket close')).toEqual({
        code: 1008,
        reason: 'Unauthorized',
      });
      expectSanitized({ connected });
    }
  });

  it('allows OWNER, ADMIN and OPERATOR roles and rejects unsupported roles', async () => {
    for (const role of ['OWNER', 'ADMIN', 'OPERATOR']) {
      const { socket, connected } = await connect(operatorPath(operatorToken(role)));
      expect(connected).toEqual({ type: 'connected', tenantId: fixture.tenantA });
      await closeSocket(socket);
    }

    const { connected, closed } = await connect(operatorPath(operatorToken('AUDITOR')));
    expect(connected).toEqual({ type: 'error', message: 'Forbidden' });
    expect(await withTimeout(closed, 'WebSocket close')).toEqual({
      code: 1008,
      reason: 'Forbidden',
    });
  });

  it('rejects operator browser origins outside ADMIN_CORS_ORIGINS', async () => {
    const denied = await connectUntilClose(operatorPath(operatorToken('OWNER')), {
      origin: 'https://evil.example',
    });
    expect(denied.close).toEqual({ code: 1008, reason: 'Origin not allowed' });
    expectSanitized(denied.close);

    const allowed = await connect(operatorPath(operatorToken('OWNER')), { origin: ADMIN_ORIGIN });
    expect(allowed.connected).toEqual({ type: 'connected', tenantId: fixture.tenantA });
  });

  it('rejects missing, incorrect and cross-agent visitor credentials', async () => {
    const missing = await connect(visitorPath());
    expect(missing.connected).toEqual({
      type: 'error',
      message: 'Missing sessionId or agentKey',
    });
    expect((await withTimeout(missing.closed, 'WebSocket close')).code).toBe(1008);

    for (const [sessionId, agentKey] of [
      [fixture.sessionA, 'wrong-agent-key'],
      [fixture.sessionB, fixture.agentAKey],
    ]) {
      const denied = await connect(visitorPath(sessionId, agentKey));
      expect(denied.connected).toEqual({ type: 'error', message: 'Session not found' });
      expect((await withTimeout(denied.closed, 'WebSocket close')).code).toBe(1008);
      expectSanitized(denied.connected);
    }
  });

  it('enforces the selected agent origin on visitor sockets', async () => {
    const denied = await connectUntilClose(visitorPath(fixture.sessionA, fixture.agentAKey), {
      origin: 'https://widget-b.example',
    });
    expect(denied.close).toEqual({ code: 1008, reason: 'Origin not allowed' });

    const allowed = await connect(visitorPath(fixture.sessionA, fixture.agentAKey), {
      origin: 'https://widget-a.example',
    });
    expect(allowed.connected).toEqual({ type: 'connected', sessionId: fixture.sessionA });
  });

  it('broadcasts operator and visitor events only to the selected tenant and session', async () => {
    const operatorA = await connect(operatorPath(operatorToken('OPERATOR', fixture.tenantA)));
    const operatorB = await connect(operatorPath(operatorToken('OPERATOR', fixture.tenantB)));
    const visitorA = await connect(visitorPath(fixture.sessionA, fixture.agentAKey), {
      origin: 'https://widget-a.example',
    });
    const visitorB = await connect(visitorPath(fixture.sessionB, fixture.agentBKey), {
      origin: 'https://widget-b.example',
    });

    const tenantAEvent: HubEvent = {
      type: 'session:status',
      tenantId: fixture.tenantA,
      sessionId: fixture.sessionA,
      status: 'WITH_OPERATOR',
    };
    const tenantBControl: HubEvent = {
      type: 'session:status',
      tenantId: fixture.tenantB,
      sessionId: fixture.sessionB,
      status: 'ACTIVE',
    };
    const operatorAMessage = nextMessage(operatorA.socket);
    const operatorBMessage = nextMessage(operatorB.socket);
    publishToOperators(fixture.tenantA, tenantAEvent);
    publishToOperators(fixture.tenantB, tenantBControl);
    expect(await operatorAMessage).toEqual(tenantAEvent);
    expect(await operatorBMessage).toEqual(tenantBControl);

    const visitorAEvent: HubEvent = {
      type: 'operator:message',
      sessionId: fixture.sessionA,
      content: 'tenant-a-only',
      authorId: 'operator-a',
    };
    const visitorBControl: HubEvent = {
      type: 'operator:message',
      sessionId: fixture.sessionB,
      content: 'tenant-b-control',
      authorId: 'operator-b',
    };
    const visitorAMessage = nextMessage(visitorA.socket);
    const visitorBMessage = nextMessage(visitorB.socket);
    publishToVisitor(fixture.sessionA, visitorAEvent);
    publishToVisitor(fixture.sessionB, visitorBControl);
    expect(await visitorAMessage).toEqual(visitorAEvent);
    expect(await visitorBMessage).toEqual(visitorBControl);
  });

  it('does not route client-supplied business events into another tenant session', async () => {
    const operatorA = await connect(operatorPath(operatorToken('OPERATOR', fixture.tenantA)));
    const visitorA = await connect(visitorPath(fixture.sessionA, fixture.agentAKey), {
      origin: 'https://widget-a.example',
    });
    const visitorB = await connect(visitorPath(fixture.sessionB, fixture.agentBKey), {
      origin: 'https://widget-b.example',
    });

    operatorA.socket.send(
      JSON.stringify({
        type: 'operator:message',
        sessionId: fixture.sessionB,
        content: 'cross-tenant injection',
        providerKey: 'provider-key-must-not-leak',
      }),
    );
    const operatorPong = nextMessage(operatorA.socket);
    operatorA.socket.send(JSON.stringify({ type: 'ping' }));
    expect(await operatorPong).toEqual({ type: 'pong' });

    visitorA.socket.send(
      JSON.stringify({
        type: 'session:message',
        sessionId: fixture.sessionB,
        content: 'visitor injection',
      }),
    );
    const visitorPong = nextMessage(visitorA.socket);
    visitorA.socket.send(JSON.stringify({ type: 'ping' }));
    expect(await visitorPong).toEqual({ type: 'pong' });

    const control: HubEvent = {
      type: 'operator:joined',
      sessionId: fixture.sessionB,
      operatorName: 'Expected control',
    };
    const visitorBMessage = nextMessage(visitorB.socket);
    publishToVisitor(fixture.sessionB, control);
    expect(await visitorBMessage).toEqual(control);
  });

  it('ignores malformed and unknown payloads while keeping the socket usable', async () => {
    const operator = await connect(operatorPath(operatorToken('OWNER')));
    const visitor = await connect(visitorPath(fixture.sessionA, fixture.agentAKey), {
      origin: 'https://widget-a.example',
    });

    for (const socket of [operator.socket, visitor.socket]) {
      socket.send('{not-json');
      socket.send('null');
      socket.send(JSON.stringify({ type: 'unknown', secret: 'provider-key' }));
      const pong = nextMessage(socket);
      socket.send(JSON.stringify({ type: 'ping', unexpected: { nested: true } }));
      const response = await pong;
      expect(response).toEqual({ type: 'pong' });
      expectSanitized(response);
      expect(socket.readyState).toBe(WebSocket.OPEN);
    }
  });

  it('removes tenant and session subscriptions when sockets close', async () => {
    const operator = await connect(operatorPath(operatorToken('OWNER')));
    const visitor = await connect(visitorPath(fixture.sessionA, fixture.agentAKey), {
      origin: 'https://widget-a.example',
    });

    expect(getRealtimeConnectionCounts()).toEqual({
      operatorTenants: 1,
      operatorSockets: 1,
      visitorSessions: 1,
      visitorSockets: 1,
    });

    await closeSocket(operator.socket);
    await closeSocket(visitor.socket);

    expect(getRealtimeConnectionCounts()).toEqual({
      operatorTenants: 0,
      operatorSockets: 0,
      visitorSessions: 0,
      visitorSockets: 0,
    });
  });
});
