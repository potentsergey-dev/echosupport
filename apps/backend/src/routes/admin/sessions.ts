import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db/prisma.js';

const adminSessionRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /admin/agents/:id/sessions ───────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/agents/:id/sessions',
    { preHandler: [fastify.requireRole(['OWNER', 'ADMIN'])] },
    async (req, reply) => {
      const agent = await prisma.agent.findFirst({
        where: { id: req.params.id, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!agent) return reply.status(404).send({ error: 'Agent not found' });

      const rows = await prisma.session.findMany({
        where: { agentId: req.params.id },
        select: {
          id: true,
          agentId: true,
          visitorId: true,
          closedAt: true,
          expiresAt: true,
          startedAt: true,
          summary: true,
          _count: { select: { messages: true } },
        },
        orderBy: { startedAt: 'desc' },
        take: 100,
      });

      const sessions = rows.map((r) => ({
        ...r,
        status: r.closedAt ? 'CLOSED' : 'ACTIVE',
        createdAt: r.startedAt,
      }));

      return reply.send(sessions);
    },
  );

  // ── DELETE /admin/sessions/:sessionId ────────────────────────────────────
  fastify.delete<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId',
    { preHandler: [fastify.requireRole(['OWNER', 'ADMIN'])] },
    async (req, reply) => {
      // Verify the session belongs to one of the tenant's agents
      const session = await prisma.session.findFirst({
        where: {
          id: req.params.sessionId,
          agent: { tenantId: req.user.tenantId },
        },
        select: { id: true },
      });

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      await prisma.session.delete({ where: { id: req.params.sessionId } });
      return reply.status(204).send();
    },
  );

  // ── GET /admin/csat ──────────────────────────────────────────────────────
  // Returns CSAT summary + individual ratings for the tenant
  fastify.get('/csat', { preHandler: [fastify.authenticate] }, async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const agentId = query['agentId'];

    const where = {
      agent: { tenantId: req.user.tenantId },
      csatRating: { not: null },
      ...(agentId ? { agentId } : {}),
    };

    const sessions = await prisma.session.findMany({
      where,
      select: {
        id: true,
        agentId: true,
        csatRating: true,
        csatComment: true,
        visitorName: true,
        startedAt: true,
        agent: { select: { name: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 500,
    });

    const total = sessions.length;
    const positive = sessions.filter((s) => (s.csatRating ?? 0) > 0).length;
    const negative = sessions.filter((s) => (s.csatRating ?? 0) < 0).length;

    return {
      summary: {
        total,
        positive,
        negative,
        score: total > 0 ? Math.round((positive / total) * 100) : null,
      },
      ratings: sessions,
    };
  });
};

export default adminSessionRoutes;
