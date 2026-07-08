/**
 * Operator API routes (accessible by OWNER, ADMIN, OPERATOR):
 *
 *   GET    /operator/inbox               — list sessions with filters
 *   GET    /operator/sessions/:id        — session detail with messages
 *   POST   /operator/sessions/:id/take   — take over session
 *   POST   /operator/sessions/:id/messages — send operator message
 *   POST   /operator/sessions/:id/return-to-agent
 *   POST   /operator/sessions/:id/resolve
 *   PATCH  /operator/sessions/:id        — update tags / note
 *   GET    /operator/canned-responses
 *   POST   /operator/canned-responses
 *   DELETE /operator/canned-responses/:cannedId
 *   PATCH  /operator/me/status
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import {
  publishToOperators,
  publishToVisitor,
  type MessageSummary,
} from '../../services/realtime-hub.js';
import { getAgentSecrets } from '../../services/agent-secrets.js';
import { chatCompletion } from '../../adapters/llm/openrouter.js';
import { env } from '../../config/env.js';
import { isSlotWithinWorkingHours } from '../../services/slot-finder.js';
import { buildSuggestedReplyTranscript } from '../../services/suggested-reply.js';
import { APPOINTMENT_STATUSES, getBookableServiceForSpecialist } from '../../services/booking.js';
import { summarizeError } from '../../services/error-sanitizer.js';

const OPERATOR_ROLES = ['OWNER', 'ADMIN', 'OPERATOR'];
const CLOSED_SESSION_STATUSES = new Set(['RESOLVED', 'CLOSED']);

const operatorRoutes: FastifyPluginAsync = async (fastify) => {
  // Shared preHandler: require operator role
  const operatorAuth = fastify.requireRole(OPERATOR_ROLES);

  // ── GET /operator/inbox ────────────────────────────────────────────────────
  fastify.get('/inbox', { preHandler: [operatorAuth] }, async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const statusFilter = query['status']; // WAITING_OPERATOR | WITH_OPERATOR | RESOLVED | ALL_OPEN
    const agentId = query['agentId'];

    const where: Record<string, unknown> = {
      agent: { tenantId: req.user.tenantId },
    };

    if (agentId) where['agentId'] = agentId;

    if (statusFilter === 'ALL_OPEN') {
      where['status'] = { in: ['ACTIVE', 'WAITING_OPERATOR', 'WITH_OPERATOR'] };
    } else if (statusFilter) {
      where['status'] = statusFilter;
    } else {
      // Default: show active + waiting + with_operator
      where['status'] = { in: ['ACTIVE', 'WAITING_OPERATOR', 'WITH_OPERATOR'] };
    }

    const sessions = await prisma.session.findMany({
      where: where as NonNullable<
        NonNullable<Parameters<typeof prisma.session.findMany>[0]>['where']
      >,
      orderBy: { lastActiveAt: 'desc' },
      take: 100,
      select: {
        id: true,
        agentId: true,
        status: true,
        visitorId: true,
        visitorName: true,
        visitorContact: true,
        pageUrl: true,
        startedAt: true,
        lastActiveAt: true,
        unreadByOperator: true,
        assignedOperatorId: true,
        handoffRequestedAt: true,
        handoffReason: true,
        internalNote: true,
        tags: true,
        agent: { select: { name: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, createdAt: true, authorType: true },
        },
      },
    });

    return reply.send(
      sessions.map(({ agent, startedAt, ...session }) => ({
        ...session,
        agentName: agent.name,
        createdAt: startedAt,
      })),
    );
  });

  // ── GET /operator/sessions/:id ─────────────────────────────────────────────
  fastify.get('/sessions/:id', { preHandler: [operatorAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const session = await prisma.session.findFirst({
      where: { id, agent: { tenantId: req.user.tenantId } },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            content: true,
            role: true,
            authorType: true,
            authorId: true,
            isInternal: true,
            createdAt: true,
          },
        },
        agent: { select: { name: true, id: true } },
      },
    });

    if (!session) return reply.status(404).send({ error: 'Session not found' });

    // Mark as read by operator
    await prisma.session.update({
      where: { id },
      data: { unreadByOperator: 0 },
    });

    return reply.send({
      ...session,
      agentName: session.agent.name,
      createdAt: session.startedAt,
    });
  });

  // ── POST /operator/sessions/:id/take ──────────────────────────────────────
  fastify.post('/sessions/:id/take', { preHandler: [operatorAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const session = await prisma.session.findFirst({
      where: { id, agent: { tenantId: req.user.tenantId } },
      select: { id: true, agentId: true, status: true, agent: { select: { tenantId: true } } },
    });
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    if (CLOSED_SESSION_STATUSES.has(session.status)) {
      return reply.status(409).send({ error: 'Cannot take a closed session' });
    }

    const updated = await prisma.session.update({
      where: { id },
      data: {
        status: 'WITH_OPERATOR',
        assignedOperatorId: req.user.sub,
      },
    });

    // Notify visitor
    publishToVisitor(id, {
      type: 'operator:joined',
      sessionId: id,
      operatorName: req.user.email,
    });

    // Notify other operators
    publishToOperators(session.agent.tenantId, {
      type: 'session:status',
      tenantId: session.agent.tenantId,
      sessionId: id,
      status: 'WITH_OPERATOR',
    });

    return reply.send(updated);
  });

  // ── POST /operator/sessions/:id/messages ──────────────────────────────────
  const SendMessageSchema = z.object({
    content: z.string().trim().min(1).max(10000),
    isInternal: z.boolean().default(false),
  });

  fastify.post('/sessions/:id/messages', { preHandler: [operatorAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const session = await prisma.session.findFirst({
      where: { id, agent: { tenantId: req.user.tenantId } },
      select: { id: true, agentId: true, status: true, agent: { select: { tenantId: true } } },
    });
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    if (session.status !== 'WITH_OPERATOR') {
      return reply
        .status(409)
        .send({ error: 'Take the session before sending an operator message' });
    }

    const result = SendMessageSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten().fieldErrors });
    }

    const { content, isInternal } = result.data;

    const message = await prisma.message.create({
      data: {
        sessionId: id,
        role: 'ASSISTANT',
        content,
        authorType: 'OPERATOR',
        authorId: req.user.sub,
        isInternal,
      },
    });

    await prisma.session.update({
      where: { id },
      data: {
        lastActiveAt: new Date(),
        ...(isInternal ? {} : { unreadByVisitor: { increment: 1 } }),
      },
    });

    const msgSummary: MessageSummary = {
      id: message.id,
      sessionId: id,
      content,
      authorType: 'OPERATOR',
      authorId: req.user.sub,
      isInternal,
      createdAt: message.createdAt,
    };

    if (!isInternal) {
      publishToVisitor(id, {
        type: 'operator:message',
        sessionId: id,
        content,
        authorId: req.user.sub,
      });
    }

    publishToOperators(session.agent.tenantId, {
      type: 'session:message',
      tenantId: session.agent.tenantId,
      sessionId: id,
      message: msgSummary,
    });

    return reply.status(201).send(message);
  });

  // ── POST /operator/sessions/:id/return-to-agent ───────────────────────────
  fastify.post(
    '/sessions/:id/return-to-agent',
    { preHandler: [operatorAuth] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const session = await prisma.session.findFirst({
        where: { id, agent: { tenantId: req.user.tenantId } },
        select: { id: true, status: true, agent: { select: { tenantId: true } } },
      });
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      if (CLOSED_SESSION_STATUSES.has(session.status)) {
        return reply.status(409).send({ error: 'Cannot return a closed session to the agent' });
      }

      const updated = await prisma.session.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          assignedOperatorId: null,
          handoffRequestedAt: null,
          handoffReason: null,
        },
      });

      publishToVisitor(id, {
        type: 'session:status',
        tenantId: session.agent.tenantId,
        sessionId: id,
        status: 'ACTIVE',
      });

      publishToOperators(session.agent.tenantId, {
        type: 'session:status',
        tenantId: session.agent.tenantId,
        sessionId: id,
        status: 'ACTIVE',
      });

      return reply.send(updated);
    },
  );

  // ── POST /operator/sessions/:id/resolve ───────────────────────────────────
  const ResolveSchema = z.object({
    tags: z.array(z.string()).optional(),
    internalNote: z.string().max(5000).optional(),
  });

  fastify.post('/sessions/:id/resolve', { preHandler: [operatorAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const session = await prisma.session.findFirst({
      where: { id, agent: { tenantId: req.user.tenantId } },
      select: { id: true, status: true, agent: { select: { tenantId: true } } },
    });
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const result = ResolveSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten().fieldErrors });
    }
    if (CLOSED_SESSION_STATUSES.has(session.status)) {
      return reply.status(409).send({ error: 'Session is already closed' });
    }
    const { tags, internalNote } = result.data;

    const updated = await prisma.session.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        closedAt: new Date(),
        ...(tags && { tags }),
        ...(internalNote && { internalNote }),
      },
    });

    publishToOperators(session.agent.tenantId, {
      type: 'session:status',
      tenantId: session.agent.tenantId,
      sessionId: id,
      status: 'RESOLVED',
    });
    publishToVisitor(id, {
      type: 'session:status',
      tenantId: session.agent.tenantId,
      sessionId: id,
      status: 'RESOLVED',
    });

    return reply.send(updated);
  });

  // ── PATCH /operator/sessions/:id ──────────────────────────────────────────
  const PatchSessionSchema = z.object({
    tags: z.array(z.string()).optional(),
    internalNote: z.string().max(5000).optional().nullable(),
    visitorName: z.string().max(200).optional().nullable(),
    visitorContact: z.string().max(500).optional().nullable(),
  });

  fastify.patch('/sessions/:id', { preHandler: [operatorAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const session = await prisma.session.findFirst({
      where: { id, agent: { tenantId: req.user.tenantId } },
      select: { id: true },
    });
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const result = PatchSessionSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten().fieldErrors });
    }

    const { tags, internalNote, visitorName, visitorContact } = result.data;
    const updateData: {
      tags?: string[];
      internalNote?: string | null;
      visitorName?: string | null;
      visitorContact?: string | null;
    } = {};
    if (tags !== undefined) updateData.tags = tags;
    if (internalNote !== undefined) updateData.internalNote = internalNote;
    if (visitorName !== undefined) updateData.visitorName = visitorName;
    if (visitorContact !== undefined) updateData.visitorContact = visitorContact;

    const updated = await prisma.session.update({
      where: { id },
      data: updateData,
    });

    return reply.send(updated);
  });

  // ── GET /operator/canned-responses ────────────────────────────────────────
  fastify.get('/canned-responses', { preHandler: [operatorAuth] }, async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const agentId = query['agentId'];

    const responses = await prisma.cannedResponse.findMany({
      where: {
        tenantId: req.user.tenantId,
        ...(agentId ? { OR: [{ agentId }, { agentId: null }] } : {}),
      },
      orderBy: { shortcut: 'asc' },
    });

    // Map `text` to `content` for API consumers
    return reply.send(responses.map(({ text, ...r }) => ({ ...r, content: text })));
  });

  // ── POST /operator/canned-responses ───────────────────────────────────────
  const CannedResponseSchema = z.object({
    shortcut: z.string().min(1).max(50).regex(/^\//, 'Shortcut must start with /'),
    content: z.string().min(1).max(5000),
    agentId: z.string().optional().nullable(),
    language: z.string().max(10).optional().nullable(),
  });

  fastify.post(
    '/canned-responses',
    { preHandler: [fastify.requireRole(['OWNER', 'ADMIN'])] },
    async (req, reply) => {
      const result = CannedResponseSchema.safeParse(req.body);
      if (!result.success) {
        return reply.status(400).send({ error: result.error.flatten().fieldErrors });
      }

      const { shortcut, content, agentId, language } = result.data;

      const cr = await prisma.cannedResponse.create({
        data: {
          tenantId: req.user.tenantId,
          shortcut,
          text: content,
          agentId: agentId ?? null,
          language: language ?? null,
        },
      });

      const { text, ...rest } = cr;
      return reply.status(201).send({ ...rest, content: text });
    },
  );

  // ── DELETE /operator/canned-responses/:cannedId ───────────────────────────
  fastify.delete(
    '/canned-responses/:cannedId',
    { preHandler: [fastify.requireRole(['OWNER', 'ADMIN'])] },
    async (req, reply) => {
      const { cannedId } = req.params as { cannedId: string };

      const cr = await prisma.cannedResponse.findFirst({
        where: { id: cannedId, tenantId: req.user.tenantId },
      });
      if (!cr) return reply.status(404).send({ error: 'Not found' });

      await prisma.cannedResponse.delete({ where: { id: cannedId } });
      return reply.status(204).send();
    },
  );

  // ── PATCH /operator/me/status ─────────────────────────────────────────────
  // Placeholder: presence/status stored client-side for now; could be added to User model later.
  fastify.patch('/me/status', { preHandler: [operatorAuth] }, async (req, reply) => {
    const result = z.object({ status: z.enum(['online', 'away', 'offline']) }).safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid status' });
    }
    // Broadcast status change to operator peers in same tenant
    publishToOperators(req.user.tenantId, {
      type: 'session:status',
      tenantId: req.user.tenantId,
      sessionId: '__operator_status__',
      status: `${req.user.sub}:${result.data.status}`,
    });
    return reply.send({ ok: true, status: result.data.status });
  });

  // ── POST /operator/me/push-subscription ───────────────────────────────────
  fastify.post('/me/push-subscription', { preHandler: [operatorAuth] }, async (req, reply) => {
    const schema = z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string(), auth: z.string() }),
    });
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid push subscription' });
    }
    const { endpoint, keys } = result.data;
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: req.user.sub,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    });
    return reply.status(201).send({ ok: true });
  });

  // ── DELETE /operator/me/push-subscription ─────────────────────────────────
  fastify.delete('/me/push-subscription', { preHandler: [operatorAuth] }, async (req, reply) => {
    const result = z.object({ endpoint: z.string().url() }).safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid endpoint' });
    }
    await prisma.pushSubscription
      .delete({ where: { endpoint: result.data.endpoint } })
      .catch(() => undefined); // ignore not-found
    return reply.send({ ok: true });
  });

  // ── POST /operator/sessions/:id/suggest-reply ─────────────────────────────
  // Generate LLM draft reply for operator based on session history
  fastify.post(
    '/sessions/:id/suggest-reply',
    { preHandler: [operatorAuth] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const session = await prisma.session.findFirst({
        where: { id, agent: { tenantId: req.user.tenantId } },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { content: true, authorType: true, isInternal: true },
          },
          agent: { select: { systemPrompt: true, name: true, llmModel: true } },
        },
      });
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      if (session.status === 'RESOLVED' || session.status === 'CLOSED') {
        return reply.status(409).send({ error: 'Cannot suggest a reply for a closed session' });
      }

      // `desc + take` selects the latest 20 rows; reverse restores chronological
      // order before building the transcript for the LLM.
      const transcript = buildSuggestedReplyTranscript([...session.messages].reverse());
      if (!transcript) {
        return reply.status(409).send({ error: 'The session has no messages to reply to' });
      }

      // Use agent's LLM key
      const secrets = await getAgentSecrets(session.agentId).catch(
        () => ({}) as Record<string, string>,
      );
      const apiKey = secrets['openrouterKey'] ?? env.OPENROUTER_API_KEY;
      if (!apiKey)
        return reply.status(400).send({ error: 'No LLM API key configured for this agent' });

      const systemPrompt = `You are a helpful customer support operator assistant for "${session.agent.name}".
Your job is to draft a short, professional reply for the operator to send to the visitor.
Reply in the same language as the conversation. Be concise (1-3 sentences).
Only output the reply text — no meta-commentary.`;

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        {
          role: 'user' as const,
          content: `Conversation so far:\n${transcript}\n\nDraft the operator's next reply:`,
        },
      ];

      try {
        const draft = (await chatCompletion(messages, session.agent.llmModel, apiKey)).trim();
        if (!draft) return reply.status(502).send({ error: 'LLM returned an empty reply' });
        return reply.send({ draft });
      } catch (err) {
        fastify.log.error({ err: summarizeError(err) }, 'suggest-reply LLM error');
        return reply.status(502).send({ error: 'LLM unavailable' });
      }
    },
  );

  // ── GET /operator/appointments ─────────────────────────────────────────────
  fastify.get('/appointments', { preHandler: [operatorAuth] }, async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const status = query['status'];
    const from = query['from'] ? new Date(query['from']) : undefined;
    const to = query['to'] ? new Date(query['to']) : undefined;
    const specialistId = query['specialistId'];

    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return reply.status(400).send({ error: 'Invalid date filter' });
    }

    const where: Record<string, unknown> = { tenantId: req.user.tenantId };
    if (status) {
      if (!APPOINTMENT_STATUSES.includes(status as (typeof APPOINTMENT_STATUSES)[number])) {
        return reply.status(400).send({ error: 'Invalid appointment status' });
      }
      where['status'] = status;
    }
    if (specialistId) {
      const specialist = await prisma.specialist.findFirst({
        where: { id: specialistId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!specialist) return reply.status(404).send({ error: 'Specialist not found' });
      where['specialistId'] = specialistId;
    }
    if (from || to) {
      where['startsAt'] = {
        ...(from && { gte: from }),
        ...(to && { lte: to }),
      };
    }

    const appointments = await prisma.appointment.findMany({
      where: where as NonNullable<
        NonNullable<Parameters<typeof prisma.appointment.findMany>[0]>['where']
      >,
      include: {
        specialist: { select: { id: true, name: true, role: true } },
        service: { select: { id: true, name: true, durationMin: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 200,
    });

    return reply.send(appointments);
  });

  // ── POST /operator/appointments ────────────────────────────────────────────
  const CreateAppointmentSchema = z.object({
    specialistId: z.string(),
    serviceId: z.string().optional(),
    visitorName: z.string().min(2).max(200),
    visitorPhone: z.string().regex(/^\+?[\d\s\-().]{7,20}$/, 'Invalid phone'),
    visitorEmail: z.string().email().optional(),
    startsAt: z.string().datetime(),
    notes: z.string().max(5000).optional(),
    sessionId: z.string().optional(),
  });

  fastify.post('/appointments', { preHandler: [operatorAuth] }, async (req, reply) => {
    const result = CreateAppointmentSchema.safeParse(req.body);
    if (!result.success)
      return reply.status(400).send({ error: result.error.flatten().fieldErrors });

    const {
      specialistId,
      serviceId,
      visitorName,
      visitorPhone,
      visitorEmail,
      startsAt: startsAtStr,
      notes,
      sessionId,
    } = result.data;

    // Verify specialist belongs to tenant
    const specialist = await prisma.specialist.findFirst({
      where: { id: specialistId, tenantId: req.user.tenantId, isActive: true },
    });
    if (!specialist) return reply.status(400).send({ error: 'Specialist not found' });

    const bookableService = await getBookableServiceForSpecialist({
      tenantId: req.user.tenantId,
      specialistId,
      serviceId,
    });
    if (!bookableService) {
      return reply.status(400).send({ error: 'Service not found for this specialist' });
    }

    const startsAt = new Date(startsAtStr);
    if (startsAt.getTime() < Date.now()) {
      return reply.status(400).send({ error: 'Appointment time must be in the future' });
    }
    const endsAt = new Date(startsAt.getTime() + bookableService.durationMin * 60 * 1000);

    if (sessionId) {
      const session = await prisma.session.findFirst({
        where: { id: sessionId, agent: { tenantId: req.user.tenantId } },
        select: { id: true },
      });
      if (!session) return reply.status(400).send({ error: 'Session not found' });
    }

    // Validate slot is within specialist's working hours
    const withinHours = await isSlotWithinWorkingHours(specialistId, startsAt, endsAt);
    if (!withinHours) {
      return reply
        .status(400)
        .send({ error: "The requested time is outside the specialist's working hours." });
    }

    // Slot conflict check + create in transaction
    const appointment = await prisma
      .$transaction(async (tx) => {
        const conflict = await tx.appointment.findFirst({
          where: {
            specialistId,
            status: { notIn: ['CANCELLED'] },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
        });
        if (conflict) throw new Error('SLOT_TAKEN');

        return tx.appointment.create({
          data: {
            tenantId: req.user.tenantId,
            specialistId,
            serviceId: bookableService.id,
            visitorName,
            visitorPhone,
            visitorEmail: visitorEmail ?? null,
            startsAt,
            endsAt,
            status: 'PENDING',
            source: 'OPERATOR',
            notes: notes ?? null,
            createdByUserId: req.user.sub,
            sessionId: sessionId ?? null,
          },
          include: {
            specialist: { select: { id: true, name: true, role: true } },
            service: { select: { id: true, name: true } },
          },
        });
      })
      .catch((err: Error) => {
        if (err.message === 'SLOT_TAKEN') return null;
        throw err;
      });

    if (!appointment) {
      return reply
        .status(409)
        .send({ error: 'Time slot is already booked. Please choose another.' });
    }

    return reply.status(201).send(appointment);
  });

  // ── PATCH /operator/appointments/:id/confirm ───────────────────────────────
  fastify.patch('/appointments/:id/confirm', { preHandler: [operatorAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const appt = await prisma.appointment.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true, status: true },
    });
    if (!appt) return reply.status(404).send({ error: 'Appointment not found' });

    const updated = await prisma.appointment.update({
      where: { id },
      data: { status: 'CONFIRMED' },
      include: {
        specialist: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
      },
    });

    return reply.send(updated);
  });

  // ── PATCH /operator/appointments/:id/cancel ────────────────────────────────
  fastify.patch('/appointments/:id/cancel', { preHandler: [operatorAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ reason: z.string().max(500).optional() }).safeParse(req.body);

    const appt = await prisma.appointment.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!appt) return reply.status(404).send({ error: 'Appointment not found' });

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        ...(body.success && body.data.reason ? { notes: body.data.reason } : {}),
      },
    });

    return reply.send(updated);
  });

  // ── PATCH /operator/appointments/:id/reschedule ────────────────────────────
  fastify.patch(
    '/appointments/:id/reschedule',
    { preHandler: [operatorAuth] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = z.object({ startsAt: z.string().datetime() }).safeParse(req.body);
      if (!result.success)
        return reply.status(400).send({ error: 'startsAt required (ISO datetime)' });

      const appt = await prisma.appointment.findFirst({
        where: { id, tenantId: req.user.tenantId },
        include: { service: { select: { durationMin: true } } },
      });
      if (!appt) return reply.status(404).send({ error: 'Appointment not found' });

      const durationMin = appt.service?.durationMin ?? 60;
      const startsAt = new Date(result.data.startsAt);
      if (startsAt.getTime() < Date.now()) {
        return reply.status(400).send({ error: 'Appointment time must be in the future' });
      }
      const endsAt = new Date(startsAt.getTime() + durationMin * 60 * 1000);

      const withinHours = await isSlotWithinWorkingHours(appt.specialistId, startsAt, endsAt);
      if (!withinHours) {
        return reply
          .status(400)
          .send({ error: "The requested time is outside the specialist's working hours." });
      }

      // Slot conflict check (exclude this appointment)
      const conflict = await prisma.appointment.findFirst({
        where: {
          specialistId: appt.specialistId,
          status: { notIn: ['CANCELLED'] },
          id: { not: id },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      });
      if (conflict)
        return reply
          .status(409)
          .send({ error: 'New time slot conflicts with existing appointment' });

      const updated = await prisma.appointment.update({
        where: { id },
        data: { startsAt, endsAt, status: 'PENDING' },
        include: {
          specialist: { select: { id: true, name: true } },
          service: { select: { id: true, name: true } },
        },
      });

      return reply.send(updated);
    },
  );

  // ── PATCH /operator/appointments/:id ──────────────────────────────────────
  fastify.patch('/appointments/:id', { preHandler: [operatorAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const schema = z.object({
      notes: z.string().max(5000).optional().nullable(),
      visitorName: z.string().max(200).optional(),
      visitorPhone: z.string().max(50).optional(),
      visitorEmail: z.string().email().optional().nullable(),
      status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).optional(),
    });
    const result = schema.safeParse(req.body);
    if (!result.success)
      return reply.status(400).send({ error: result.error.flatten().fieldErrors });

    const appt = await prisma.appointment.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!appt) return reply.status(404).send({ error: 'Appointment not found' });

    const { notes, visitorName, visitorPhone, visitorEmail, status } = result.data;
    const apptUpdateData: Record<string, unknown> = {};
    if (notes !== undefined) apptUpdateData['notes'] = notes;
    if (visitorName !== undefined) apptUpdateData['visitorName'] = visitorName;
    if (visitorPhone !== undefined) apptUpdateData['visitorPhone'] = visitorPhone;
    if (visitorEmail !== undefined) apptUpdateData['visitorEmail'] = visitorEmail;
    if (status !== undefined) apptUpdateData['status'] = status;

    const updated = await prisma.appointment.update({
      where: { id },
      data: apptUpdateData,
      include: {
        specialist: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
      },
    });
    return reply.send(updated);
  });
};

export default operatorRoutes;
