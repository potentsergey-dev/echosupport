import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import authPlugin from '../plugins/auth.js';
import { SessionStoreUnavailableError } from '../services/session-auth.js';

async function appFor(error: Error) {
  const app = Fastify();
  app.decorate('deps', {
    authWorkspace: { authenticateRequest: vi.fn().mockRejectedValue(error) },
  } as never);
  await app.register(authPlugin);
  app.get('/authenticate', { preHandler: app.authenticate }, async () => ({ ok: true }));
  app.get('/query-token', { preHandler: app.authenticateQueryToken }, async () => ({ ok: true }));
  app.get('/role', { preHandler: app.requireRole(['OWNER']) }, async () => ({ ok: true }));
  return app;
}

describe('authentication failure mapping', () => {
  it.each(['/authenticate', '/query-token', '/role'])(
    'returns 503 for an unavailable session store on %s',
    async (path) => {
      const app = await appFor(new SessionStoreUnavailableError());
      try {
        const response = await app.inject({ method: 'GET', url: path });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: 'Authentication temporarily unavailable' });
      } finally {
        await app.close();
      }
    },
  );

  it('keeps a missing or invalid session as 401', async () => {
    const app = await appFor(new Error('Invalid session'));
    try {
      const response = await app.inject({ method: 'GET', url: '/authenticate' });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'Unauthorized' });
    } finally {
      await app.close();
    }
  });
});
