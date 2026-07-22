import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { encrypt, decrypt } from '../../services/crypto.js';
import { clearAgentSecretsCache } from '../../services/agent-secrets.js';
import { checkQdrantConnection } from '../../adapters/vectorstore/qdrant.js';

// ── Zod schemas ─────────────────────────────────────────────────────────────

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.string().optional(),
  greetingMessage: z.string().max(500).optional(),
  proactiveMessageDelay: z.number().int().min(5).max(3600).nullable().optional(),
  proactiveMessageText: z.string().trim().max(500).nullable().optional(),
  systemPrompt: z.string().min(1),
  llmModel: z.string().default('openai/gpt-4o-mini'),
  language: z.string().default('auto'),
  sessionTtlMinutes: z.number().int().min(5).max(10080).default(120),
  sourcePriority: z.enum(['MERGE', 'FILES_FIRST', 'URL_FIRST']).default('MERGE'),
  sttProvider: z.enum(['DEEPGRAM', 'WHISPER']).default('DEEPGRAM'),
  allowedOrigins: z.array(z.string()).default([]),
  // Phase 10.5 anti-abuse settings
  maxMessagesPerHourPerVisitor: z.number().int().min(1).max(1000).default(60),
  maxSessionsPerDayPerVisitor: z.number().int().min(1).max(100).default(10),
  maxMessageLength: z.number().int().min(100).max(10000).default(2000),
  // Phase 10.6 booking
  bookingEnabled: z.boolean().default(false),
});

const UpdateAgentSchema = CreateAgentSchema.partial();

const SecretsSchema = z
  .object({
    openrouterKey: z.string().min(1).optional(),
    openrouterEmbeddingKey: z.string().min(1).optional(),
    openaiKey: z.string().min(1).optional(),
    openaiEmbeddingKey: z.string().min(1).optional(),
    deepgramKey: z.string().min(1).optional(),
  })
  .refine(
    (d) =>
      d.openrouterKey ??
      d.openrouterEmbeddingKey ??
      d.openaiKey ??
      d.openaiEmbeddingKey ??
      d.deepgramKey,
    { message: 'At least one secret must be provided' },
  );

// ── Helpers ─────────────────────────────────────────────────────────────────

const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function generatePublicKey(): string {
  return `pk_${randomBytes(16).toString('hex')}`;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

type ConfigCheckStatus = 'ok' | 'warning' | 'error';

interface ConfigCheckItem {
  id: string;
  label: string;
  status: ConfigCheckStatus;
  message: string;
  action?: string;
}

function summarizeConfigStatus(items: ConfigCheckItem[]): ConfigCheckStatus {
  if (items.some((item) => item.status === 'error')) return 'error';
  if (items.some((item) => item.status === 'warning')) return 'warning';
  return 'ok';
}

async function dependencyCheck(
  id: string,
  label: string,
  check: () => Promise<unknown>,
  okMessage: string,
  errorMessage: string,
  action: string,
): Promise<ConfigCheckItem> {
  try {
    await check();
    return { id, label, status: 'ok', message: okMessage };
  } catch {
    return { id, label, status: 'error', message: errorMessage, action };
  }
}

// Agent fields safe to return in list and detail responses (never encryptedSecrets)
const AGENT_SAFE_SELECT = {
  id: true,
  name: true,
  role: true,
  avatarUrl: true,
  greetingMessage: true,
  proactiveMessageDelay: true,
  proactiveMessageText: true,
  systemPrompt: true,
  llmModel: true,
  embeddingModel: true,
  language: true,
  sourcePriority: true,
  sttProvider: true,
  sessionTtlMinutes: true,
  allowedOrigins: true,
  isActive: true,
  publicKey: true,
  maxMessagesPerHourPerVisitor: true,
  maxSessionsPerDayPerVisitor: true,
  maxMessageLength: true,
  bookingEnabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ── Route plugin ─────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['OWNER', 'ADMIN'] as const;

const agentRoutes: FastifyPluginAsync = async (fastify) => {
  // All routes below require OWNER or ADMIN role
  fastify.addHook('preHandler', fastify.requireRole([...ADMIN_ROLES]));

  // ── GET /admin/agents ──────────────────────────────────────────────────────
  fastify.get('/agents', async (req, reply) => {
    const agents = await prisma.agent.findMany({
      where: { tenantId: req.user.tenantId },
      select: { ...AGENT_SAFE_SELECT, systemPrompt: false },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(agents);
  });

  // ── POST /admin/agents ────────────────────────────────────────────────────
  fastify.post('/agents', async (req, reply) => {
    const result = CreateAgentSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten().fieldErrors });
    }
    const d = result.data;

    const agent = await prisma.agent.create({
      data: {
        tenantId: req.user.tenantId,
        name: d.name,
        ...(d.role !== undefined ? { role: d.role } : {}),
        ...(d.greetingMessage !== undefined ? { greetingMessage: d.greetingMessage } : {}),
        ...(d.proactiveMessageDelay !== undefined
          ? { proactiveMessageDelay: d.proactiveMessageDelay }
          : {}),
        ...(d.proactiveMessageText !== undefined
          ? { proactiveMessageText: d.proactiveMessageText || null }
          : {}),
        systemPrompt: d.systemPrompt,
        llmModel: d.llmModel,
        language: d.language,
        sessionTtlMinutes: d.sessionTtlMinutes,
        sourcePriority: d.sourcePriority,
        sttProvider: d.sttProvider,
        allowedOrigins: d.allowedOrigins,
        maxMessagesPerHourPerVisitor: d.maxMessagesPerHourPerVisitor,
        maxSessionsPerDayPerVisitor: d.maxSessionsPerDayPerVisitor,
        maxMessageLength: d.maxMessageLength,
        bookingEnabled: d.bookingEnabled,
        publicKey: generatePublicKey(),
      },
      select: AGENT_SAFE_SELECT,
    });

    return reply.status(201).send(agent);
  });

  // ── GET /admin/agents/:id ─────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/agents/:id', async (req, reply) => {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      select: {
        ...AGENT_SAFE_SELECT,
        _count: { select: { documents: true, sources: true } },
      },
    });
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return reply.send(agent);
  });

  // ── PATCH /admin/agents/:id ───────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/agents/:id', async (req, reply) => {
    const result = UpdateAgentSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten().fieldErrors });
    }

    const existing = await prisma.agent.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Agent not found' });

    const d = result.data;
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.role !== undefined ? { role: d.role } : {}),
        ...(d.greetingMessage !== undefined ? { greetingMessage: d.greetingMessage } : {}),
        ...(d.proactiveMessageDelay !== undefined
          ? { proactiveMessageDelay: d.proactiveMessageDelay }
          : {}),
        ...(d.proactiveMessageText !== undefined
          ? { proactiveMessageText: d.proactiveMessageText || null }
          : {}),
        ...(d.systemPrompt !== undefined ? { systemPrompt: d.systemPrompt } : {}),
        ...(d.llmModel !== undefined ? { llmModel: d.llmModel } : {}),
        ...(d.language !== undefined ? { language: d.language } : {}),
        ...(d.sessionTtlMinutes !== undefined ? { sessionTtlMinutes: d.sessionTtlMinutes } : {}),
        ...(d.sourcePriority !== undefined ? { sourcePriority: d.sourcePriority } : {}),
        ...(d.sttProvider !== undefined ? { sttProvider: d.sttProvider } : {}),
        ...(d.allowedOrigins !== undefined ? { allowedOrigins: d.allowedOrigins } : {}),
        ...(d.maxMessagesPerHourPerVisitor !== undefined
          ? { maxMessagesPerHourPerVisitor: d.maxMessagesPerHourPerVisitor }
          : {}),
        ...(d.maxSessionsPerDayPerVisitor !== undefined
          ? { maxSessionsPerDayPerVisitor: d.maxSessionsPerDayPerVisitor }
          : {}),
        ...(d.maxMessageLength !== undefined ? { maxMessageLength: d.maxMessageLength } : {}),
        ...(d.bookingEnabled !== undefined ? { bookingEnabled: d.bookingEnabled } : {}),
      },
      select: AGENT_SAFE_SELECT,
    });
    return reply.send(agent);
  });

  // ── DELETE /admin/agents/:id ──────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/agents/:id', async (req, reply) => {
    const existing = await prisma.agent.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Agent not found' });

    await prisma.agent.delete({ where: { id: req.params.id } });
    return reply.status(204).send();
  });

  // ── POST /admin/agents/:id/avatar ─────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/agents/:id/avatar', async (req, reply) => {
    const existing = await prisma.agent.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Agent not found' });

    const data = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } });
    if (!data) return reply.status(400).send({ error: 'No file provided' });

    if (!ALLOWED_AVATAR_MIME.has(data.mimetype)) {
      data.file.resume(); // drain stream to avoid memory leaks
      return reply.status(400).send({ error: 'Invalid file type. Allowed: jpeg, png, webp, gif' });
    }

    const avatarsDir = path.join(env.UPLOADS_DIR, 'avatars');
    fs.mkdirSync(avatarsDir, { recursive: true });

    const ext = path.extname(data.filename) || '.jpg';
    const filename = `${req.params.id}-${Date.now()}${ext}`;
    const filePath = path.join(avatarsDir, filename);

    await pipeline(data.file, fs.createWriteStream(filePath));

    const avatarUrl = `${env.PUBLIC_BASE_URL ?? env.APP_URL}/uploads/avatars/${filename}`;
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: { avatarUrl },
      select: { id: true, avatarUrl: true },
    });

    return reply.send(agent);
  });

  // ── GET /admin/agents/:id/secrets ─────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/agents/:id/secrets', async (req, reply) => {
    const existing = await prisma.agent.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      select: { id: true, encryptedSecrets: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Agent not found' });

    const secrets = (existing.encryptedSecrets ?? {}) as Record<string, string>;
    const keys = [
      'openrouterKey',
      'openrouterEmbeddingKey',
      'openaiKey',
      'openaiEmbeddingKey',
      'deepgramKey',
    ] as const;

    const masked: Record<string, string | null> = {};
    for (const key of keys) {
      masked[key] = secrets[key] ? maskSecret(decrypt(secrets[key])) : null;
    }

    return reply.send(masked);
  });

  // ── POST /admin/agents/:id/secrets ────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/agents/:id/secrets', async (req, reply) => {
    const result = SecretsSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten().fieldErrors });
    }

    const existing = await prisma.agent.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      select: { id: true, encryptedSecrets: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Agent not found' });

    const d = result.data;
    const current = (existing.encryptedSecrets ?? {}) as Record<string, string>;
    const updated: Record<string, string> = { ...current };
    const masked: Record<string, string> = {};

    if (d.openrouterKey) {
      updated['openrouterKey'] = encrypt(d.openrouterKey);
      masked['openrouterKey'] = maskSecret(d.openrouterKey);
    }
    if (d.openrouterEmbeddingKey) {
      updated['openrouterEmbeddingKey'] = encrypt(d.openrouterEmbeddingKey);
      masked['openrouterEmbeddingKey'] = maskSecret(d.openrouterEmbeddingKey);
    }
    if (d.openaiKey) {
      updated['openaiKey'] = encrypt(d.openaiKey);
      masked['openaiKey'] = maskSecret(d.openaiKey);
    }
    if (d.openaiEmbeddingKey) {
      updated['openaiEmbeddingKey'] = encrypt(d.openaiEmbeddingKey);
      masked['openaiEmbeddingKey'] = maskSecret(d.openaiEmbeddingKey);
    }
    if (d.deepgramKey) {
      updated['deepgramKey'] = encrypt(d.deepgramKey);
      masked['deepgramKey'] = maskSecret(d.deepgramKey);
    }

    await prisma.agent.update({
      where: { id: req.params.id },
      data: { encryptedSecrets: updated },
    });

    clearAgentSecretsCache(req.params.id);

    return reply.send(masked);
  });

  // ── GET /admin/agents/:id/config-check ────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/agents/:id/config-check', async (req, reply) => {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      select: {
        id: true,
        isActive: true,
        publicKey: true,
        allowedOrigins: true,
        encryptedSecrets: true,
        llmModel: true,
        embeddingModel: true,
        documents: { select: { status: true, chunksCount: true } },
        sources: { select: { status: true, pagesIndexed: true } },
      },
    });
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    const encryptedSecrets = (agent.encryptedSecrets ?? {}) as Record<string, string>;
    const hasAgentSecret = (key: string) => Boolean(encryptedSecrets[key]);
    const hasChatKey = hasAgentSecret('openrouterKey') || Boolean(env.OPENROUTER_API_KEY);
    const hasEmbeddingKey =
      hasAgentSecret('openrouterEmbeddingKey') ||
      hasAgentSecret('openaiEmbeddingKey') ||
      hasAgentSecret('openaiKey') ||
      hasAgentSecret('openrouterKey') ||
      Boolean(env.OPENROUTER_EMBEDDING_API_KEY) ||
      Boolean(env.OPENROUTER_API_KEY) ||
      Boolean(env.OPENAI_API_KEY);

    const indexedDocuments = agent.documents.filter((doc) => doc.status === 'INDEXED').length;
    const indexedSources = agent.sources.filter((source) => source.status === 'INDEXED').length;
    const failedKnowledge =
      agent.documents.filter((doc) => doc.status === 'FAILED').length +
      agent.sources.filter((source) => source.status === 'FAILED').length;
    const hasIndexedKnowledge = indexedDocuments + indexedSources > 0;

    const [database, qdrant] = await Promise.all([
      dependencyCheck(
        'database',
        'PostgreSQL',
        () => prisma.$queryRaw`SELECT 1`,
        'База данных отвечает.',
        'База данных недоступна.',
        'Проверьте DATABASE_URL и контейнер PostgreSQL.',
      ),
      dependencyCheck(
        'qdrant',
        'Qdrant',
        () => checkQdrantConnection(),
        'Векторное хранилище отвечает.',
        'Qdrant недоступен.',
        'Проверьте QDRANT_URL, QDRANT_API_KEY и контейнер qdrant.',
      ),
    ]);

    const items: ConfigCheckItem[] = [
      database,
      qdrant,
      agent.isActive
        ? { id: 'agent-active', label: 'Агент', status: 'ok', message: 'Агент активен.' }
        : {
            id: 'agent-active',
            label: 'Агент',
            status: 'error',
            message: 'Агент выключен.',
            action: 'Включите агента в профиле.',
          },
      hasChatKey
        ? {
            id: 'chat-key',
            label: 'LLM ключ',
            status: 'ok',
            message: `Ключ для ответов настроен. Модель: ${agent.llmModel}.`,
          }
        : {
            id: 'chat-key',
            label: 'LLM ключ',
            status: 'error',
            message: 'Ключ для AI-ответов не найден.',
            action: 'Добавьте OpenRouter/compatible API Key в API-ключах агента или в .env.',
          },
      hasEmbeddingKey
        ? {
            id: 'embedding-key',
            label: 'Embeddings',
            status: 'ok',
            message: `Ключ для индексации настроен. Модель: ${agent.embeddingModel}.`,
          }
        : {
            id: 'embedding-key',
            label: 'Embeddings',
            status: 'error',
            message: 'Ключ для индексации документов не найден.',
            action:
              'Добавьте embeddings-ключ или общий compatible API Key. Endpoint должен поддерживать /v1/embeddings.',
          },
      hasIndexedKnowledge
        ? {
            id: 'knowledge',
            label: 'База знаний',
            status: failedKnowledge > 0 ? 'warning' : 'ok',
            message: `Проиндексировано: файлов ${indexedDocuments}, сайтов ${indexedSources}.${
              failedKnowledge > 0 ? ` Ошибок индексации: ${failedKnowledge}.` : ''
            }`,
            ...(failedKnowledge > 0
              ? { action: 'Откройте базу знаний и проверьте элементы FAILED.' }
              : {}),
          }
        : {
            id: 'knowledge',
            label: 'База знаний',
            status: 'warning',
            message: 'Нет проиндексированных документов или сайтов.',
            action: 'Добавьте документ или сайт и запустите индексацию.',
          },
      agent.allowedOrigins.length > 0
        ? {
            id: 'origins',
            label: 'Allowed origins',
            status: 'ok',
            message: `Разрешенных origin: ${agent.allowedOrigins.length}.`,
          }
        : {
            id: 'origins',
            label: 'Allowed origins',
            status: 'warning',
            message: 'Список allowed origins пуст.',
            action: 'Для production укажите домены сайтов, где разрешен виджет.',
          },
      agent.publicKey
        ? {
            id: 'embed',
            label: 'Виджет',
            status: 'ok',
            message: `Публичный ключ есть. Embed URL: ${env.PUBLIC_BASE_URL ?? env.APP_URL}.`,
          }
        : {
            id: 'embed',
            label: 'Виджет',
            status: 'error',
            message: 'Публичный ключ агента отсутствует.',
            action: 'Создайте агента заново или восстановите publicKey в базе.',
          },
    ];

    return reply.send({
      status: summarizeConfigStatus(items),
      checkedAt: new Date().toISOString(),
      items,
    });
  });

  // ── GET /admin/agents/:id/embed-snippet ───────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/agents/:id/embed-snippet', async (req, reply) => {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      select: { publicKey: true },
    });
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    const publicBaseUrl = env.PUBLIC_BASE_URL ?? env.APP_URL;
    const snippet = `<script src="${publicBaseUrl}/embed.js" data-agent-key="${agent.publicKey}" data-api-base="${publicBaseUrl}" defer></script>`;
    return reply.send({ snippet, agentKey: agent.publicKey, publicBaseUrl });
  });
};

export default agentRoutes;
