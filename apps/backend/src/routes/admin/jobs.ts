import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../db/prisma.js';

const TERMINAL_STATUSES = new Set(['DONE', 'FAILED', 'CANCELLED']);

const jobRoutes: FastifyPluginAsync = async (fastify) => {
  // Discover on the server so reloads and another browser can recover observation.
  fastify.get(
    '/agents/:id/indexing-job',
    {
      preHandler: [fastify.requireRole(['OWNER', 'ADMIN'], { touchSession: false })],
    },
    async (req, reply) => {
      const { id: agentId } = req.params as { id: string };
      const agent = await prisma.agent.findFirst({
        where: { id: agentId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!agent) return reply.status(404).send({ error: 'Agent not found' });
      const selection = {
        id: true,
        type: true,
        agentId: true,
        status: true,
        progress: true,
        errorMessage: true,
        scheduledAt: true,
        startedAt: true,
        finishedAt: true,
      } as const;
      const active = await prisma.job.findFirst({
        where: { agentId, type: 'REINDEX_AGENT', status: { in: ['PENDING', 'RUNNING'] } },
        orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
        select: selection,
      });
      const job =
        active ??
        (await prisma.job.findFirst({
          where: { agentId, type: 'REINDEX_AGENT' },
          orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
          select: selection,
        }));
      return reply.header('Cache-Control', 'no-store').send(job);
    },
  );
  // ── GET /admin/jobs/:jobId ─────────────────────────────────────────────────
  fastify.get(
    '/jobs/:jobId',
    { preHandler: [fastify.requireRole(['OWNER', 'ADMIN'], { touchSession: false })] },
    async (req, reply) => {
      const { jobId } = req.params as { jobId: string };

      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          type: true,
          agentId: true,
          status: true,
          progress: true,
          errorMessage: true,
          scheduledAt: true,
          startedAt: true,
          finishedAt: true,
        },
      });

      if (!job || !job.agentId) return reply.status(404).send({ error: 'Job not found' });

      // Tenant isolation: verify the job's agent belongs to the current user's tenant
      const agent = await prisma.agent.findFirst({
        where: { id: job.agentId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!agent) return reply.status(404).send({ error: 'Job not found' });

      return reply.header('Cache-Control', 'no-store').send(job);
    },
  );

  // ── GET /admin/jobs/:jobId/stream  (SSE) ───────────────────────────────────
  // Uses authenticateQueryToken because EventSource cannot send custom headers —
  // the frontend passes the JWT via ?token= query param.
  fastify.get(
    '/jobs/:jobId/stream',
    {
      preHandler: [
        fastify.authenticateQueryToken,
        async (req: FastifyRequest, reply: FastifyReply) => {
          if (!['OWNER', 'ADMIN'].includes(req.user.role)) {
            return reply.status(403).send({ error: 'Forbidden' });
          }
        },
      ],
    },
    async (req, reply) => {
      const { jobId } = req.params as { jobId: string };

      // Tenant isolation check BEFORE hijacking the connection
      const initialAccess = {
        userId: req.user.sub,
        tenantId: req.user.tenantId,
        membershipId: req.user.membershipId,
      };
      const jobCheck = await prisma.job.findUnique({
        where: { id: jobId },
        select: { agentId: true },
      });
      if (!jobCheck || !jobCheck.agentId) {
        return reply.status(404).send({ error: 'Job not found' });
      }
      const agentCheck = await prisma.agent.findFirst({
        where: { id: jobCheck.agentId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!agentCheck) return reply.status(404).send({ error: 'Job not found' });

      void reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      raw.write('\n');

      const send = (event: string, data: unknown): void => {
        if (!closed) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      let closed = false;
      let polling = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        raw.end();
      };
      const timer = setInterval(() => {
        if (closed || polling) return;
        polling = true;
        void (async () => {
          try {
            const job = await prisma.job.findUnique({
              where: { id: jobId },
              select: { id: true, status: true, progress: true, errorMessage: true },
            });

            // Streams revalidate access without extending the session idle timeout.
            const access = await fastify.deps.authWorkspace.authenticateRequest(req, {
              touchSession: false,
            });
            if (
              access.userId !== initialAccess.userId ||
              access.tenantId !== initialAccess.tenantId ||
              access.membershipId !== initialAccess.membershipId ||
              !['OWNER', 'ADMIN'].includes(access.role)
            ) {
              close();
              return;
            }
            if (closed) return;
            if (!job) {
              close();
              return;
            }

            send('progress', { jobId: job.id, status: job.status, progress: job.progress });

            if (TERMINAL_STATUSES.has(job.status)) {
              send('done', { jobId: job.id, status: job.status, errorMessage: job.errorMessage });
              close();
            }
          } catch {
            close();
          } finally {
            polling = false;
          }
        })();
      }, 1_000);

      raw.on('close', close);
    },
  );
};

export default jobRoutes;
