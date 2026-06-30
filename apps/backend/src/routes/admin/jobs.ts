import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../db/prisma.js';

const TERMINAL_STATUSES = new Set(['DONE', 'FAILED', 'CANCELLED']);

const jobRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /admin/jobs/:jobId ─────────────────────────────────────────────────
  fastify.get(
    '/jobs/:jobId',
    { preHandler: [fastify.requireRole(['OWNER', 'ADMIN'])] },
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

      return reply.send(job);
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
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const timer = setInterval(() => {
        void (async () => {
          try {
            const job = await prisma.job.findUnique({
              where: { id: jobId },
              select: { id: true, status: true, progress: true, errorMessage: true },
            });

            if (!job) {
              send('error', { message: 'Job not found' });
              clearInterval(timer);
              raw.end();
              return;
            }

            send('progress', { jobId: job.id, status: job.status, progress: job.progress });

            if (TERMINAL_STATUSES.has(job.status)) {
              send('done', { jobId: job.id, status: job.status, errorMessage: job.errorMessage });
              clearInterval(timer);
              raw.end();
            }
          } catch {
            send('error', { message: 'Internal error' });
            clearInterval(timer);
            raw.end();
          }
        })();
      }, 1_000);

      req.raw.on('close', () => clearInterval(timer));
    },
  );
};

export default jobRoutes;
