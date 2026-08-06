import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';

const RequestSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(100).optional(),
  purpose: z.string().trim().min(10).max(1000),
});

const demoAccessPublicRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/access-requests',
    { config: { rateLimit: { max: 3, timeWindow: '1 day' } } },
    async (req, reply) => {
      const parsed = RequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten().fieldErrors });
      }

      const request = await prisma.demoAccessRequest.create({
        data: {
          ...parsed.data,
          company: parsed.data.company || null,
        },
      });
      return reply.status(201).send({ id: request.id, status: request.status });
    },
  );
};

export default demoAccessPublicRoutes;
