import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';

const ApproveSchema = z.object({
  expiresInHours: z.number().int().min(1).max(168).default(24),
});

function demoPassword(): string {
  return randomBytes(15).toString('base64url');
}

const demoAccessAdminRoutes: FastifyPluginAsync = async (fastify) => {
  const ownerOnly = fastify.requireRole(['OWNER']);

  fastify.get('/demo-access-requests', { preHandler: [ownerOnly] }, async () => {
    return prisma.demoAccessRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  });

  fastify.post(
    '/demo-access-requests/:id/approve',
    { preHandler: [ownerOnly] },
    async (req, reply) => {
      const parsed = ApproveSchema.safeParse(req.body ?? {});
      if (!parsed.success)
        return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
      const { id } = req.params as { id: string };
      const accessRequest = await prisma.demoAccessRequest.findUnique({ where: { id } });
      if (!accessRequest) return reply.status(404).send({ error: 'Access request not found' });

      const existing = await prisma.user.findUnique({ where: { email: accessRequest.email } });
      if (
        existing &&
        (existing.tenantId !== req.user.tenantId || existing.role !== 'DEMO_VIEWER')
      ) {
        return reply.status(409).send({ error: 'This email already belongs to a non-demo user' });
      }

      const password = demoPassword();
      const expiresAt = new Date(Date.now() + parsed.data.expiresInHours * 60 * 60 * 1000);
      const passwordHash = await hash(password, 12);
      const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: { passwordHash, accessExpiresAt: expiresAt },
          })
        : await prisma.user.create({
            data: {
              tenantId: req.user.tenantId,
              email: accessRequest.email,
              passwordHash,
              role: 'DEMO_VIEWER',
              accessExpiresAt: expiresAt,
            },
          });

      await prisma.demoAccessRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          processedAt: new Date(),
          processedBy: req.user.sub,
          accessUserId: user.id,
          expiresAt,
        },
      });

      return reply.send({
        email: user.email,
        password,
        expiresAt,
        loginUrl: new URL('/admin/login', env.PUBLIC_BASE_URL).toString(),
      });
    },
  );

  fastify.post(
    '/demo-access-requests/:id/reject',
    { preHandler: [ownerOnly] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const request = await prisma.demoAccessRequest.findUnique({ where: { id } });
      if (!request) return reply.status(404).send({ error: 'Access request not found' });
      return prisma.demoAccessRequest.update({
        where: { id },
        data: { status: 'REJECTED', processedAt: new Date(), processedBy: req.user.sub },
      });
    },
  );

  fastify.post(
    '/demo-access-requests/:id/revoke',
    { preHandler: [ownerOnly] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const request = await prisma.demoAccessRequest.findUnique({ where: { id } });
      if (!request) return reply.status(404).send({ error: 'Access request not found' });
      if (request.accessUserId) {
        await prisma.user.updateMany({
          where: { id: request.accessUserId, tenantId: req.user.tenantId, role: 'DEMO_VIEWER' },
          data: { accessExpiresAt: new Date() },
        });
      }
      return prisma.demoAccessRequest.update({
        where: { id },
        data: {
          status: 'REVOKED',
          processedAt: new Date(),
          processedBy: req.user.sub,
          expiresAt: new Date(),
        },
      });
    },
  );
};

export default demoAccessAdminRoutes;
