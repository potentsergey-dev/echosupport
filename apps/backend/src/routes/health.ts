import type { FastifyPluginAsync } from 'fastify';
import {
  checkReadiness,
  type ReadinessDependency,
  type ReadinessResult,
} from '../services/readiness.js';

interface HealthRouteOptions {
  dependencies: ReadinessDependency[];
}

const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (fastify, options) => {
  fastify.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  fastify.get('/ready', async (_request, reply) => {
    const result: ReadinessResult = await checkReadiness(options.dependencies);
    return reply.status(result.status === 'ready' ? 200 : 503).send(result);
  });
};

export default healthRoutes;
