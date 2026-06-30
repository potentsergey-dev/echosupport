import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';

/**
 * Internal cron trigger routes — called by an external scheduler (cron job, Passenger hooks).
 * Protected by a static CRON_SECRET bearer token (not a JWT).
 *
 * When CRON_SECRET is not set in env, all endpoints return 503.
 */
const internalCronRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /internal/cron/cleanup ───────────────────────────────────────────
  // Deletes expired sessions that haven't been explicitly closed.
  // Mirrors the logic in services/cleanup.ts so it works under Passenger lazy-start.
  fastify.get('/cron/cleanup', async (req, reply) => {
    if (!env.CRON_SECRET) {
      return reply.status(503).send({ error: 'Cron endpoint not configured' });
    }

    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const result = await prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    fastify.log.info({ deleted: result.count }, 'cron/cleanup: expired sessions deleted');
    return reply.send({ ok: true, deleted: result.count, timestamp: new Date().toISOString() });
  });
};

export default internalCronRoutes;
