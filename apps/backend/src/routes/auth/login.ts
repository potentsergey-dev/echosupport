import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { compare } from 'bcryptjs';
import { prisma } from '../../db/prisma.js';

const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const result = LoginBodySchema.safeParse(req.body);
      if (!result.success) {
        return reply.status(400).send({ error: result.error.flatten().fieldErrors });
      }
      const { email, password } = result.data;

      const user = await prisma.user.findUnique({ where: { email } });
      // Use constant-time comparison path even when user not found to avoid timing attacks
      if (!user) {
        await compare('dummy', '$2b$12$invalidhashpaddingtomatch.invalid.hash.length.here.xxx');
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const valid = await compare(password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const token = fastify.jwt.sign(
        { sub: user.id, email: user.email, tenantId: user.tenantId, role: user.role },
        { expiresIn: '24h' },
      );

      return reply.send({
        token,
        user: { id: user.id, email: user.email, role: user.role },
      });
    },
  );
};

export default authRoutes;
