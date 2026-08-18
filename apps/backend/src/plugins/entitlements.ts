import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { EntitlementSnapshot, FeatureKey } from '../contracts/entitlements.js';
import { assertFeature } from '../services/entitlements.js';

declare module 'fastify' {
  interface FastifyInstance {
    getEntitlements: (request: FastifyRequest) => Promise<EntitlementSnapshot>;
    requireFeature: (
      feature: FeatureKey,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const entitlementsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('getEntitlements', async (request: FastifyRequest) => {
    return fastify.deps.entitlements.getSnapshot({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
    });
  });

  fastify.decorate('requireFeature', (feature: FeatureKey) => {
    return async (request: FastifyRequest): Promise<void> => {
      await assertFeature(
        {
          tenantId: request.user.tenantId,
          userId: request.user.sub,
        },
        feature,
      );
    };
  });
};

export default fp(entitlementsPlugin, { name: 'entitlements' });
