import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createCommunityDependencies, type AppDependencies } from '../services/dependencies.js';

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDependencies;
  }
}

const dependenciesPlugin: FastifyPluginAsync<{ dependencies?: AppDependencies }> = async (
  fastify,
  options,
) => {
  fastify.decorate('deps', options.dependencies ?? createCommunityDependencies());
};

export default fp(dependenciesPlugin, { name: 'dependencies' });
