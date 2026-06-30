import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

// ── Module augmentations ────────────────────────────────────────────────────

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; tenantId: string; role: string };
    user: { sub: string; email: string; tenantId: string; role: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Like authenticate, but also accepts JWT via ?token= query param (for SSE / EventSource). */
    authenticateQueryToken: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Require one of the specified roles after authentication. */
    requireRole: (
      roles: string[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// ── Plugin ──────────────────────────────────────────────────────────────────

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    },
  );

  fastify.decorate(
    'authenticateQueryToken',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      // EventSource cannot send custom headers — accept JWT from ?token= query param as fallback
      if (!request.headers['authorization']) {
        const queryToken = (request.query as Record<string, string | undefined>)['token'];
        if (queryToken) {
          request.headers['authorization'] = `Bearer ${queryToken}`;
        }
      }
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    },
  );

  fastify.decorate('requireRole', (roles: string[]) => {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      if (!roles.includes(request.user.role)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    };
  });
};

export default fp(authPlugin, { name: 'auth' });
