import type { FastifyPluginAsync } from 'fastify';
import type { ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { retrieve } from '../../services/retriever.js';
import { buildMessages } from '../../services/prompt-builder.js';
import { chatCompletion, chatStream, type ChatMessage } from '../../adapters/llm/openrouter.js';
import { getAgentSecrets } from '../../services/agent-secrets.js';
import { summarizeIfNeeded } from '../../services/conversation-summarizer.js';
import { transcribe as transcribeDeepgram } from '../../adapters/stt/deepgram.js';
import { transcribe as transcribeWhisper } from '../../adapters/stt/whisper.js';
import { env } from '../../config/env.js';
import { checkMessageLimit, checkSessionLimit } from '../../services/visitor-rate-limit.js';
import { AGENT_TOOLS, executeTool } from '../../services/agent-tools.js';
import { isBusinessHoursNow, getOutOfHoursMessage } from '../../services/business-hours.js';
import { csatSubmissionSchema } from '../../services/csat.js';
import { summarizeError } from '../../services/error-sanitizer.js';
import { isOriginAllowed } from '../../services/origin-policy.js';
import { isExplicitHandoffRequest } from '../../services/handoff-intent.js';

// ── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
]);
const STT_MAX_MB = 25;
const STT_MAX_BYTES = STT_MAX_MB * 1024 * 1024;

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashIp(ip: string): string {
  return createHash('sha256')
    .update(ip + env.JWT_SECRET)
    .digest('hex')
    .slice(0, 16);
}

function sseWrite(raw: ServerResponse, event: string, data: unknown): void {
  raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim();
  }

  if (typeof err !== 'object' || err === null) return '';

  if ('message' in err && typeof err.message === 'string' && err.message.trim()) {
    return err.message.trim();
  }

  const nested = 'error' in err ? err.error : undefined;
  if (
    typeof nested === 'object' &&
    nested !== null &&
    'message' in nested &&
    typeof nested.message === 'string' &&
    nested.message.trim()
  ) {
    return nested.message.trim();
  }

  if ('status' in err && typeof err.status === 'number') {
    return `HTTP ${err.status}`;
  }

  return '';
}

function getErrorStatus(err: unknown): number | null {
  if (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof err.status === 'number'
  ) {
    return err.status;
  }
  return null;
}

function isToolCompatibilityError(err: unknown): boolean {
  const message = getErrorMessage(err);
  if (
    /api key|unauthorized|authentication|auth|credit|quota|rate limit|insufficient/i.test(message)
  ) {
    return false;
  }
  const status = getErrorStatus(err);
  return (
    /model|not found|unsupported|tool|function|HTTP 400|HTTP 404|HTTP 422/i.test(message) ||
    status === 400 ||
    status === 404 ||
    status === 422
  );
}

function formatPublicChatError(err: unknown): string {
  const message = getErrorMessage(err);

  if (!message) {
    return 'Assistant is temporarily unavailable. Check the LLM API key, credits, and model.';
  }

  if (/api key|unauthorized|authentication|auth/i.test(message)) {
    return 'Assistant is unavailable. Check the OpenRouter API key.';
  }

  if (/credit|quota|rate limit|insufficient/i.test(message)) {
    return 'Assistant is unavailable. Check OpenRouter credits and limits.';
  }

  if (/model|not found|unsupported/i.test(message)) {
    return 'Assistant is unavailable. Check the configured LLM model.';
  }

  if (/timeout|timed out|fetch failed|network|socket/i.test(message)) {
    return 'Assistant is unavailable. Check network access to the LLM provider.';
  }

  return 'Assistant is temporarily unavailable. Check the server logs for the exact LLM error.';
}

function formatPublicTranscriptionError(): string {
  return 'Transcription failed. Please try again later.';
}

// ── Zod schemas ──────────────────────────────────────────────────────────────

const CreateSessionSchema = z.object({
  visitorId: z.string().max(128).optional(),
  language: z.string().max(10).optional().nullable(),
  pageUrl: z.string().url().max(2000).optional().nullable(),
  pageReferrer: z.string().max(2000).optional().nullable(),
});

// Message length validated dynamically per-agent; 4000 is a hard upper ceiling
const SendMessageSchema = z.object({
  text: z.string().min(1).max(4000),
});

// ── Plugin ───────────────────────────────────────────────────────────────────

const publicSessionRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /public/sessions ─────────────────────────────────────────────────
  fastify.post(
    '/sessions',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const agentKey = req.headers['x-agent-key'];
      if (!agentKey || typeof agentKey !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Agent-Key header' });
      }

      const agent = await prisma.agent.findUnique({
        where: { publicKey: agentKey },
        select: {
          id: true,
          name: true,
          role: true,
          avatarUrl: true,
          greetingMessage: true,
          language: true,
          proactiveMessageDelay: true,
          proactiveMessageText: true,
          systemPrompt: true,
          llmModel: true,
          sessionTtlMinutes: true,
          sourcePriority: true,
          allowedOrigins: true,
          isActive: true,
          tenantId: true,
          maxMessagesPerHourPerVisitor: true,
          maxSessionsPerDayPerVisitor: true,
          maxMessageLength: true,
        },
      });

      if (!agent || !agent.isActive) {
        return reply.status(401).send({ error: 'Invalid agent key' });
      }

      const origin = req.headers['origin'];
      if (!isOriginAllowed(origin, agent.allowedOrigins)) {
        return reply.status(403).send({ error: 'Origin not allowed' });
      }

      const bodyResult = CreateSessionSchema.safeParse(req.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: bodyResult.error.flatten().fieldErrors });
      }
      const { visitorId, language, pageUrl, pageReferrer } = bodyResult.data;

      const expiresAt = new Date(Date.now() + agent.sessionTtlMinutes * 60 * 1000);
      const ipHash = req.ip ? hashIp(req.ip) : undefined;

      // Anti-abuse: check session rate limit
      const visitorKey = visitorId ?? ipHash ?? 'anon';
      const sessionCheck = await checkSessionLimit(
        agent.id,
        visitorKey,
        agent.maxSessionsPerDayPerVisitor,
      );
      if (!sessionCheck.allowed) {
        return reply.status(429).send({
          error: 'Too many sessions. Please try again later.',
          retryAfter: sessionCheck.retryAfter,
        });
      }

      const session = await prisma.session.create({
        data: {
          agentId: agent.id,
          visitorId: visitorId ?? null,
          origin: origin ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          ipHash: ipHash ?? null,
          language: language ?? null,
          pageUrl: pageUrl ?? null,
          pageReferrer: pageReferrer ?? null,
          expiresAt,
        },
        select: { id: true },
      });

      return reply.status(201).send({
        sessionId: session.id,
        agent: {
          name: agent.name,
          role: agent.role ?? null,
          avatarUrl: agent.avatarUrl ?? null,
          greetingMessage:
            agent.greetingMessage ??
            `Hello! I'm ${agent.name}${agent.role ? `, ${agent.role}` : ''}. How can I help you?`,
          proactiveMessageDelay: agent.proactiveMessageDelay,
          proactiveMessageText: agent.proactiveMessageText,
          language: agent.language,
        },
      });
    },
  );

  // ── POST /public/sessions/:sessionId/messages (SSE) ───────────────────────
  fastify.post<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/messages',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { sessionId } = req.params;

      const agentKeyHeader = req.headers['x-agent-key'];
      if (!agentKeyHeader || typeof agentKeyHeader !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Agent-Key header' });
      }

      const bodyResult = SendMessageSchema.safeParse(req.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: bodyResult.error.flatten().fieldErrors });
      }
      const { text } = bodyResult.data;

      // Validate session
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          agent: {
            select: {
              id: true,
              publicKey: true,
              systemPrompt: true,
              llmModel: true,
              sourcePriority: true,
              sessionTtlMinutes: true,
              isActive: true,
              tenantId: true,
              maxMessagesPerHourPerVisitor: true,
              maxMessageLength: true,
            },
          },
        },
      });

      if (!session || !session.agent.isActive) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (agentKeyHeader !== session.agent.publicKey) {
        return reply.status(401).send({ error: 'Invalid X-Agent-Key' });
      }
      if (session.closedAt || session.expiresAt < new Date()) {
        return reply.status(410).send({ error: 'Session expired or closed' });
      }

      // Anti-abuse: max message length
      if (text.length > session.agent.maxMessageLength) {
        return reply
          .status(400)
          .send({ error: `Message too long (max ${session.agent.maxMessageLength} characters)` });
      }

      // Anti-abuse: per-visitor message rate limit
      const visitorKey = session.visitorId ?? session.ipHash ?? 'anon';
      const msgCheck = await checkMessageLimit(
        session.agent.id,
        visitorKey,
        session.agent.maxMessagesPerHourPerVisitor,
      );
      if (!msgCheck.allowed) {
        return reply.status(429).send({
          error: 'Too many messages. Please slow down.',
          retryAfter: msgCheck.retryAfter,
        });
      }

      // Save user message
      await prisma.message.create({
        data: { sessionId, role: 'USER', content: text, authorType: 'VISITOR' },
      });

      // Increment unread count for operator
      await prisma.session.update({
        where: { id: sessionId },
        data: { unreadByOperator: { increment: 1 } },
      });

      // Hijack connection for SSE
      void reply.hijack();
      const raw = reply.raw;
      const reqOrigin = req.headers['origin'];
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...(reqOrigin && {
          'Access-Control-Allow-Origin': reqOrigin,
          'Access-Control-Allow-Credentials': 'true',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        }),
      });
      raw.write('\n');

      if (session.status === 'WAITING_OPERATOR' || session.status === 'WITH_OPERATOR') {
        await prisma.session.update({
          where: { id: sessionId },
          data: { lastActiveAt: new Date() },
        });
        sseWrite(raw, 'done', {
          messageId: null,
          fullText: '',
          tokensIn: null,
          tokensOut: null,
          retrievedSources: [],
          handoffRequested: session.status === 'WAITING_OPERATOR',
          routedToOperator: true,
        });
        raw.end();
        return;
      }

      try {
        sseWrite(raw, 'typing', { typing: true });

        // Load recent history (exclude the message we just saved)
        const history = await prisma.message.findMany({
          where: {
            sessionId,
            NOT: { role: 'USER', content: text, createdAt: { gte: new Date(Date.now() - 2000) } },
          },
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true },
          take: 40,
        });

        // Retrieve relevant context
        const agent = session.agent;
        const chunks = await retrieve(agent.id, text, {
          topK: 5,
          sourcePriority: agent.sourcePriority as 'MERGE' | 'FILES_FIRST' | 'URL_FIRST',
        });

        // Get business hours context for system prompt
        const inHours = await isBusinessHoursNow(agent.id);
        const outOfHoursMsg = inHours ? null : await getOutOfHoursMessage(agent.id);
        const now = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', hour12: false }).format(
          new Date(),
        );
        const businessHoursContext = inHours
          ? `Current time: ${now}. Operators are currently available. You may escalate to a human if needed.`
          : `Current time: ${now}. This is OUTSIDE business hours. ${outOfHoursMsg ?? 'Operators are not available right now.'}. If the user needs human assistance, inform them and offer to collect their contact info for a callback.`;

        // Build prompt
        const messages = buildMessages({
          agentSystemPrompt: agent.systemPrompt,
          chunks,
          history: history.map((m) => ({
            role: m.role as 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL',
            content: m.content,
          })),
          summary: session.summary,
          userText: text,
          businessHoursContext,
        });

        // Resolve LLM API key
        let openrouterKey = env.OPENROUTER_API_KEY;
        try {
          const secrets = await getAgentSecrets(agent.id);
          if (secrets.openrouterKey) openrouterKey = secrets.openrouterKey;
        } catch {
          // No agent secrets
        }

        if (!openrouterKey) {
          sseWrite(raw, 'error', {
            code: 'config_error',
            message: 'No LLM API key configured for this agent',
          });
          raw.end();
          return;
        }

        // Stream response — with tool-call support (max 3 rounds to prevent loops)
        const tokens: string[] = [];
        const startMs = Date.now();
        let handoffSideEffect = false;
        let usage = { tokensIn: 0, tokensOut: 0 };

        // Mutable messages for tool-call loop
        const llmMessages = [...messages] as ChatMessage[];

        if (env.ECHOSUPPORT_DEMO_MARKETING_SEED === 'true') {
          if (isExplicitHandoffRequest(text)) {
            const toolResult = await executeTool(
              'request_handoff',
              { reason: 'Visitor explicitly requested a human operator in the demo widget.' },
              { sessionId, agentId: agent.id, tenantId: agent.tenantId },
            );
            handoffSideEffect = toolResult.sideEffect === 'handoff_requested';
          }

          const completionText = await chatCompletion(llmMessages, agent.llmModel, openrouterKey);
          tokens.push(completionText);
          sseWrite(raw, 'delta', { text: completionText });
        } else {
          for (let round = 0; round < 3; round++) {
            const isFirstRound = round === 0;
            const roundTokens: string[] = [];

            const streamTokens = (token: string) => {
              if (isFirstRound || round > 0) {
                tokens.push(token);
                roundTokens.push(token);
              }
              sseWrite(raw, 'delta', { text: token });
            };

            let result;
            try {
              result = await chatStream(
                llmMessages,
                agent.llmModel,
                openrouterKey,
                streamTokens,
                AGENT_TOOLS,
              );
            } catch (err) {
              if (!isFirstRound || tokens.length > 0 || !isToolCompatibilityError(err)) {
                throw err;
              }
              req.log.warn(
                { err: summarizeError(err), agentId: agent.id, model: agent.llmModel },
                'Retrying assistant response without tools after LLM tool request failed',
              );
              try {
                result = await chatStream(llmMessages, agent.llmModel, openrouterKey, streamTokens);
              } catch (fallbackErr) {
                if (!isToolCompatibilityError(fallbackErr)) throw fallbackErr;
                req.log.warn(
                  { err: summarizeError(fallbackErr), agentId: agent.id, model: agent.llmModel },
                  'Retrying assistant response without streaming after LLM stream request failed',
                );
                const completionText = await chatCompletion(
                  llmMessages,
                  agent.llmModel,
                  openrouterKey,
                );
                streamTokens(completionText);
                result = { usage: { tokensIn: 0, tokensOut: 0 } };
              }
            }

            usage = result.usage;

            if (!result.toolCalls || result.toolCalls.length === 0) {
              // No tool calls — we're done
              break;
            }

            // Process tool calls — server-side execution only
            const assistantContent = roundTokens.join('');
            if (assistantContent) {
              llmMessages.push({ role: 'assistant', content: assistantContent });
            } else {
              // LLM returned only tool calls (no text before them)
              llmMessages.push({
                role: 'assistant',
                content: '',
              });
            }

            for (const tc of result.toolCalls) {
              const toolResult = await executeTool(tc.name, tc.arguments, {
                sessionId,
                agentId: agent.id,
                tenantId: session.agent.tenantId,
              });

              if (toolResult.sideEffect === 'handoff_requested') {
                handoffSideEffect = true;
              }
              if (toolResult.quickReplies) {
                sseWrite(raw, 'quick_replies', { replies: toolResult.quickReplies });
              }

              // Add tool result back to messages
              llmMessages.push({
                role: 'tool',
                content: toolResult.result,
                tool_call_id: tc.id,
              });
            }
          }
        }
        const fullText = tokens.join('');
        const latencyMs = Date.now() - startMs;

        // Persist assistant message
        const assistantMsg = await prisma.message.create({
          data: {
            sessionId,
            role: 'ASSISTANT',
            content: fullText,
            authorType: 'AGENT',
            tokensIn: usage.tokensIn || null,
            tokensOut: usage.tokensOut || null,
            latencyMs,
          },
          select: { id: true },
        });

        // Extend session TTL
        await prisma.session.update({
          where: { id: sessionId },
          data: {
            lastActiveAt: new Date(),
            expiresAt: new Date(Date.now() + agent.sessionTtlMinutes * 60 * 1000),
          },
        });

        const retrievedSources = chunks.map((c) => ({
          label: c.sourceLabel ?? '',
          type: c.sourceType.toLowerCase(),
        }));

        sseWrite(raw, 'done', {
          messageId: assistantMsg.id,
          fullText,
          tokensIn: usage.tokensIn || null,
          tokensOut: usage.tokensOut || null,
          retrievedSources,
          handoffRequested: handoffSideEffect,
        });

        // Schedule summarization asynchronously
        summarizeIfNeeded(sessionId).catch(() => undefined);
      } catch (err: unknown) {
        req.log.error(
          { err: summarizeError(err), sessionId, agentId: session.agent.id },
          'Failed to stream assistant response',
        );
        sseWrite(raw, 'error', {
          code: 'internal_error',
          message: env.NODE_ENV === 'development' ? String(err) : formatPublicChatError(err),
        });
      } finally {
        raw.end();
      }
    },
  );

  // ── POST /public/sessions/:sessionId/stt ─────────────────────────────────
  fastify.post<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/stt',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { sessionId } = req.params;

      const agentKeyHeader = req.headers['x-agent-key'];
      if (!agentKeyHeader || typeof agentKeyHeader !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Agent-Key header' });
      }

      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          agent: {
            select: { id: true, publicKey: true, isActive: true, sttProvider: true },
          },
        },
      });

      if (!session || !session.agent.isActive) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (agentKeyHeader !== session.agent.publicKey) {
        return reply.status(401).send({ error: 'Invalid X-Agent-Key' });
      }
      if (session.closedAt || session.expiresAt < new Date()) {
        return reply.status(410).send({ error: 'Session expired or closed' });
      }

      const data = await req.file({ limits: { fileSize: STT_MAX_BYTES } });
      if (!data) {
        return reply.status(400).send({ error: 'Audio file is required' });
      }

      // Normalize mimeType: strip codec parameters for validation (e.g. 'audio/webm;codecs=opus' → 'audio/webm')
      const rawMimeType = data.mimetype;
      const baseMimeType = rawMimeType.split(';')[0]!.trim();
      const mimeType = rawMimeType; // keep full type for transcription APIs
      if (!ALLOWED_AUDIO_TYPES.has(rawMimeType) && !ALLOWED_AUDIO_TYPES.has(baseMimeType)) {
        return reply.status(400).send({
          error: `Unsupported audio type: ${rawMimeType}. Allowed: audio/webm, audio/mp4, audio/wav`,
        });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer);
      }
      const audioBuffer = Buffer.concat(chunks);

      if (audioBuffer.length > STT_MAX_BYTES || data.file.truncated) {
        return reply.status(413).send({ error: `Audio file too large (max ${STT_MAX_MB} MB)` });
      }

      if (audioBuffer.length === 0) {
        return reply.status(400).send({ error: 'Audio file is empty' });
      }

      const agent = session.agent;
      const secrets = await getAgentSecrets(agent.id).catch(() => ({}) as Record<string, string>);

      if (agent.sttProvider === 'WHISPER') {
        const openaiKey = secrets.openaiKey ?? env.OPENAI_API_KEY;
        if (!openaiKey) {
          return reply.status(503).send({
            error: 'STT is not configured. Add an OpenAI API key in agent settings (for Whisper).',
          });
        }
        try {
          const result = await transcribeWhisper(audioBuffer, mimeType, openaiKey);
          return reply.send(result);
        } catch (err) {
          req.log.error(
            { err: summarizeError(err), agentId: agent.id },
            'Whisper transcription failed',
          );
          return reply.status(502).send({ error: formatPublicTranscriptionError() });
        }
      }

      // Default: DEEPGRAM
      const deepgramKey = secrets.deepgramKey ?? env.DEEPGRAM_API_KEY;
      if (!deepgramKey) {
        return reply.status(503).send({
          error:
            'STT is not configured. Add a Deepgram API key in agent settings, or switch STT provider to Whisper and add an OpenAI API key.',
        });
      }
      try {
        const result = await transcribeDeepgram(audioBuffer, mimeType, deepgramKey);
        return reply.send(result);
      } catch (err) {
        req.log.error(
          { err: summarizeError(err), agentId: agent.id },
          'Deepgram transcription failed',
        );
        return reply.status(502).send({ error: formatPublicTranscriptionError() });
      }
    },
  );

  // ── POST /public/sessions/:sessionId/close ────────────────────────────────
  fastify.post<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/close',
    async (req, reply) => {
      const { sessionId } = req.params;

      const agentKeyHeader = req.headers['x-agent-key'];
      if (!agentKeyHeader || typeof agentKeyHeader !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Agent-Key header' });
      }

      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { agent: { select: { publicKey: true } } },
      });

      if (!session) return reply.status(404).send({ error: 'Session not found' });
      if (agentKeyHeader !== session.agent.publicKey) {
        return reply.status(401).send({ error: 'Invalid X-Agent-Key' });
      }
      if (session.closedAt) return reply.status(200).send({ ok: true });

      await prisma.session.update({
        where: { id: sessionId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });

      return reply.send({ ok: true });
    },
  );

  // ── POST /public/sessions/:sessionId/csat ─────────────────────────────────
  // Called by widget after session is RESOLVED or CLOSED to submit CSAT rating
  fastify.post<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/csat',
    async (req, reply) => {
      const { sessionId } = req.params;

      const agentKeyHeader = req.headers['x-agent-key'];
      if (!agentKeyHeader || typeof agentKeyHeader !== 'string') {
        return reply.status(401).send({ error: 'Missing X-Agent-Key header' });
      }

      const result = csatSubmissionSchema.safeParse(req.body);
      if (!result.success)
        return reply.status(400).send({ error: result.error.flatten().fieldErrors });

      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { agent: { select: { publicKey: true } } },
      });

      if (!session) return reply.status(404).send({ error: 'Session not found' });
      if (agentKeyHeader !== session.agent.publicKey) {
        return reply.status(401).send({ error: 'Invalid X-Agent-Key' });
      }
      if (session.status !== 'RESOLVED' && session.status !== 'CLOSED') {
        return reply.status(409).send({ error: 'CSAT is available after the session is resolved' });
      }
      // Allow only once
      if (session.csatRating !== null) return reply.status(200).send({ ok: true });

      await prisma.session.updateMany({
        where: { id: sessionId, csatRating: null },
        data: {
          csatRating: result.data.rating,
          ...(result.data.comment ? { csatComment: result.data.comment } : { csatComment: null }),
        },
      });

      return reply.send({ ok: true });
    },
  );
};

export default publicSessionRoutes;
