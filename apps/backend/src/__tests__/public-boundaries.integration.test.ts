import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../db/prisma.js';
import publicSessionRoutes from '../routes/public/sessions.js';
import { encrypt } from '../services/crypto.js';
import { chatStream } from '../adapters/llm/openrouter.js';
import { retrieve } from '../services/retriever.js';
import { transcribe as transcribeDeepgram } from '../adapters/stt/deepgram.js';
import { transcribe as transcribeWhisper } from '../adapters/stt/whisper.js';

vi.mock('../services/retriever.js', () => ({
  retrieve: vi.fn(),
}));

vi.mock('../adapters/llm/openrouter.js', () => ({
  chatStream: vi.fn(),
}));

vi.mock('../adapters/stt/deepgram.js', () => ({
  transcribe: vi.fn(),
}));

vi.mock('../adapters/stt/whisper.js', () => ({
  transcribe: vi.fn(),
}));

vi.mock('../services/business-hours.js', () => ({
  isBusinessHoursNow: vi.fn().mockResolvedValue(true),
  getOutOfHoursMessage: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/conversation-summarizer.js', () => ({
  summarizeIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

interface Fixture {
  agentA: string;
  agentB: string;
  agentAKey: string;
  agentBKey: string;
  sessionA: string;
  sessionB: string;
}

const PROVIDER_KEY = 'provider-key-public-boundary';
const PROVIDER_SECRET_BODY = `provider failed with ${PROVIDER_KEY} postgresql://secret-db node_modules/stack`;

let app: FastifyInstance;

async function buildTestServer(): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(multipart);
  await server.register(publicSessionRoutes, { prefix: '/api/v1/public' });
  return server;
}

async function seedFixture(): Promise<Fixture> {
  await prisma.tenant.deleteMany();
  const [tenantA, tenantB] = await Promise.all([
    prisma.tenant.create({ data: { name: 'Public Boundary Tenant A' } }),
    prisma.tenant.create({ data: { name: 'Public Boundary Tenant B' } }),
  ]);
  const [agentA, agentB] = await Promise.all([
    prisma.agent.create({
      data: {
        tenantId: tenantA.id,
        name: 'Public Agent A',
        systemPrompt: 'Tenant A only',
        publicKey: 'pk_public_boundary_a',
        allowedOrigins: ['https://widget-a.example'],
        encryptedSecrets: {
          openrouterKey: encrypt(PROVIDER_KEY),
          deepgramKey: encrypt(PROVIDER_KEY),
        },
        maxMessagesPerHourPerVisitor: 2,
        maxSessionsPerDayPerVisitor: 1,
        maxMessageLength: 20,
      },
    }),
    prisma.agent.create({
      data: {
        tenantId: tenantB.id,
        name: 'Public Agent B',
        systemPrompt: 'Tenant B only',
        publicKey: 'pk_public_boundary_b',
        allowedOrigins: ['https://widget-b.example'],
        encryptedSecrets: {
          openaiKey: encrypt(PROVIDER_KEY),
        },
        sttProvider: 'WHISPER',
      },
    }),
  ]);
  const expiresAt = new Date(Date.now() + 60_000);
  const [sessionA, sessionB] = await Promise.all([
    prisma.session.create({ data: { agentId: agentA.id, visitorId: 'visitor-a', expiresAt } }),
    prisma.session.create({ data: { agentId: agentB.id, visitorId: 'visitor-b', expiresAt } }),
  ]);

  return {
    agentA: agentA.id,
    agentB: agentB.id,
    agentAKey: agentA.publicKey,
    agentBKey: agentB.publicKey,
    sessionA: sessionA.id,
    sessionB: sessionB.id,
  };
}

function expectSanitized(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(PROVIDER_KEY);
  expect(serialized).not.toContain('postgresql://');
  expect(serialized).not.toContain('node_modules');
  expect(serialized).not.toContain(' at ');
}

function parseSse(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  return body
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const event = chunk
        .split('\n')
        .find((line) => line.startsWith('event: '))
        ?.slice(7)
        .trim();
      const data = chunk
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice(6)
        .trim();
      return {
        event: event ?? '',
        data: data ? (JSON.parse(data) as Record<string, unknown>) : {},
      };
    });
}

async function sttRequest(
  sessionId: string,
  agentKey: string,
  options: { contentType?: string; body?: string | Buffer } = {},
) {
  const boundary = '----public-boundary-test';
  const contentType = options.contentType ?? 'audio/webm';
  const body = options.body ?? 'audio-bytes';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio.webm"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    Buffer.isBuffer(body) ? body : Buffer.from(body),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return app.inject({
    method: 'POST',
    url: `/api/v1/public/sessions/${sessionId}/stt`,
    headers: {
      'x-agent-key': agentKey,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

describe('public chat/STT/provider boundaries (PostgreSQL)', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    vi.mocked(retrieve).mockResolvedValue([]);
    vi.mocked(chatStream).mockImplementation(async (_messages, _model, _apiKey, onDelta) => {
      onDelta('safe answer');
      return { usage: { tokensIn: 10, tokensOut: 2 } };
    });
    vi.mocked(transcribeDeepgram).mockResolvedValue({
      text: 'hello',
      language: 'en',
      durationMs: 123,
    });
    vi.mocked(transcribeWhisper).mockResolvedValue({
      text: 'whisper hello',
      language: 'en',
      durationMs: 456,
    });

    fixture = await seedFixture();
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany();
    await prisma.$disconnect();
  });

  it('creates sessions only for active agent keys and allowed origins', async () => {
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/public/sessions',
      headers: {
        'x-agent-key': fixture.agentAKey,
        origin: 'https://widget-a.example',
      },
      payload: { visitorId: 'new-visitor', pageUrl: 'https://site.example/page' },
    });
    const deniedOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/public/sessions',
      headers: {
        'x-agent-key': fixture.agentAKey,
        origin: 'https://widget-b.example',
      },
      payload: { visitorId: 'denied-visitor' },
    });
    const badKey = await app.inject({
      method: 'POST',
      url: '/api/v1/public/sessions',
      headers: { 'x-agent-key': 'wrong-key', origin: 'https://widget-a.example' },
      payload: { visitorId: 'bad-key-visitor' },
    });

    expect(allowed.statusCode).toBe(201);
    expect(allowed.json()).toMatchObject({ agent: { name: 'Public Agent A' } });
    expect(deniedOrigin.statusCode).toBe(403);
    expect(deniedOrigin.json()).toEqual({ error: 'Origin not allowed' });
    expect(badKey.statusCode).toBe(401);
    expect(retrieve).not.toHaveBeenCalled();
    expect(chatStream).not.toHaveBeenCalled();
  });

  it('does not call RAG or LLM for cross-agent, expired, or too-long messages', async () => {
    const crossAgent = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sessions/${fixture.sessionB}/messages`,
      headers: { 'x-agent-key': fixture.agentAKey },
      payload: { text: 'hello' },
    });
    const tooLong = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sessions/${fixture.sessionA}/messages`,
      headers: { 'x-agent-key': fixture.agentAKey },
      payload: { text: 'x'.repeat(21) },
    });
    await prisma.session.update({
      where: { id: fixture.sessionA },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expired = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sessions/${fixture.sessionA}/messages`,
      headers: { 'x-agent-key': fixture.agentAKey },
      payload: { text: 'hello' },
    });

    expect(crossAgent.statusCode).toBe(401);
    expect(tooLong.statusCode).toBe(400);
    expect(expired.statusCode).toBe(410);
    expect(retrieve).not.toHaveBeenCalled();
    expect(chatStream).not.toHaveBeenCalled();
    expect(await prisma.message.count()).toBe(0);
  });

  it('enforces public session and message rate limits before extra provider work', async () => {
    const firstSession = await app.inject({
      method: 'POST',
      url: '/api/v1/public/sessions',
      headers: {
        'x-agent-key': fixture.agentAKey,
        origin: 'https://widget-a.example',
      },
      payload: { visitorId: 'rate-limited-visitor' },
    });
    const secondSession = await app.inject({
      method: 'POST',
      url: '/api/v1/public/sessions',
      headers: {
        'x-agent-key': fixture.agentAKey,
        origin: 'https://widget-a.example',
      },
      payload: { visitorId: 'rate-limited-visitor' },
    });

    expect(firstSession.statusCode).toBe(201);
    expect(secondSession.statusCode).toBe(429);
    expect(chatStream).not.toHaveBeenCalled();

    for (const text of ['one', 'two']) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/public/sessions/${fixture.sessionA}/messages`,
        headers: { 'x-agent-key': fixture.agentAKey },
        payload: { text },
      });
      expect(response.statusCode).toBe(200);
    }

    const rateLimitedMessage = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sessions/${fixture.sessionA}/messages`,
      headers: { 'x-agent-key': fixture.agentAKey },
      payload: { text: 'three' },
    });

    expect(rateLimitedMessage.statusCode).toBe(429);
    expect(chatStream).toHaveBeenCalledTimes(2);
  });

  it('streams valid messages through the bound agent provider key and records only that session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sessions/${fixture.sessionA}/messages`,
      headers: { 'x-agent-key': fixture.agentAKey },
      payload: { text: 'hello' },
    });

    expect(response.statusCode).toBe(200);
    const events = parseSse(response.body);
    expect(events.map((event) => event.event)).toEqual(['typing', 'delta', 'done']);
    expect(events.at(-1)?.data).toMatchObject({ fullText: 'safe answer' });
    expect(retrieve).toHaveBeenCalledWith(
      fixture.agentA,
      'hello',
      expect.objectContaining({ topK: 5 }),
    );
    expect(chatStream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      PROVIDER_KEY,
      expect.any(Function),
      expect.any(Array),
    );

    const sessionAMessages = await prisma.message.findMany({
      where: { sessionId: fixture.sessionA },
      orderBy: { createdAt: 'asc' },
    });
    expect(sessionAMessages.map((message) => message.role)).toEqual(['USER', 'ASSISTANT']);
    expect(await prisma.message.count({ where: { sessionId: fixture.sessionB } })).toBe(0);
  });

  it('sanitizes public LLM errors and keeps provider details out of SSE payloads', async () => {
    vi.mocked(chatStream).mockRejectedValueOnce(new Error(PROVIDER_SECRET_BODY));

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sessions/${fixture.sessionA}/messages`,
      headers: { 'x-agent-key': fixture.agentAKey },
      payload: { text: 'hello' },
    });

    expect(response.statusCode).toBe(200);
    const events = parseSse(response.body);
    const errorEvent = events.find((event) => event.event === 'error');
    expect(errorEvent?.data).toMatchObject({ code: 'internal_error' });
    expectSanitized(errorEvent);
    expectSanitized(response.body);
  });

  it('does not call STT providers for cross-agent, expired, missing, oversized, empty, or unsupported uploads', async () => {
    const crossAgent = await sttRequest(fixture.sessionB, fixture.agentAKey);
    const unsupported = await sttRequest(fixture.sessionA, fixture.agentAKey, {
      contentType: 'text/plain',
    });
    const empty = await sttRequest(fixture.sessionA, fixture.agentAKey, { body: Buffer.alloc(0) });
    const oversized = await sttRequest(fixture.sessionA, fixture.agentAKey, {
      body: Buffer.alloc(25 * 1024 * 1024 + 1),
    });
    const missing = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sessions/${fixture.sessionA}/stt`,
      headers: { 'x-agent-key': fixture.agentAKey },
    });
    await prisma.session.update({
      where: { id: fixture.sessionA },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expired = await sttRequest(fixture.sessionA, fixture.agentAKey);

    expect(crossAgent.statusCode).toBe(401);
    expect(unsupported.statusCode).toBe(400);
    expect(empty.statusCode).toBe(400);
    expect(oversized.statusCode).toBe(413);
    expect(expired.statusCode).toBe(410);
    expect(missing.statusCode).toBe(406);
    expect(transcribeDeepgram).not.toHaveBeenCalled();
    expect(transcribeWhisper).not.toHaveBeenCalled();
  });

  it('uses the selected STT provider only after session binding succeeds', async () => {
    const deepgram = await sttRequest(fixture.sessionA, fixture.agentAKey, {
      contentType: 'audio/webm;codecs=opus',
    });
    const whisper = await sttRequest(fixture.sessionB, fixture.agentBKey, {
      contentType: 'audio/mp4',
    });

    expect(deepgram.statusCode).toBe(200);
    expect(deepgram.json()).toEqual({ text: 'hello', language: 'en', durationMs: 123 });
    expect(whisper.statusCode).toBe(200);
    expect(whisper.json()).toEqual({ text: 'whisper hello', language: 'en', durationMs: 456 });
    expect(transcribeDeepgram).toHaveBeenCalledOnce();
    expect(transcribeDeepgram).toHaveBeenCalledWith(expect.any(Buffer), 'audio/webm', PROVIDER_KEY);
    expect(transcribeWhisper).toHaveBeenCalledOnce();
    expect(transcribeWhisper).toHaveBeenCalledWith(expect.any(Buffer), 'audio/mp4', PROVIDER_KEY);
  });

  it('sanitizes public STT provider failures', async () => {
    vi.mocked(transcribeDeepgram).mockRejectedValueOnce(new Error(PROVIDER_SECRET_BODY));

    const response = await sttRequest(fixture.sessionA, fixture.agentAKey);

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: 'Transcription failed. Please try again later.',
    });
    expectSanitized(response.body);
  });

  it('prevents foreign agent keys from closing sessions or submitting CSAT', async () => {
    await prisma.session.update({
      where: { id: fixture.sessionB },
      data: { status: 'RESOLVED' },
    });

    const close = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sessions/${fixture.sessionB}/close`,
      headers: { 'x-agent-key': fixture.agentAKey },
    });
    const csat = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sessions/${fixture.sessionB}/csat`,
      headers: { 'x-agent-key': fixture.agentAKey },
      payload: { rating: 1, comment: 'cross-agent write' },
    });

    expect(close.statusCode).toBe(401);
    expect(csat.statusCode).toBe(401);
    expect(await prisma.session.findUnique({ where: { id: fixture.sessionB } })).toMatchObject({
      closedAt: null,
      csatRating: null,
      csatComment: null,
    });
  });
});
