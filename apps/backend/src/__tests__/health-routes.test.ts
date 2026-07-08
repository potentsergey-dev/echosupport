import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import healthRoutes from '../routes/health.js';
import type { ReadinessDependency } from '../services/readiness.js';

async function buildTestServer(dependencies: ReadinessDependency[]) {
  const app = Fastify({ logger: false });
  await app.register(healthRoutes, { prefix: '/api/v1', dependencies });
  return app;
}

function dependencies(
  database: () => Promise<void>,
  qdrant: () => Promise<void>,
): ReadinessDependency[] {
  return [
    { name: 'database', check: database },
    { name: 'qdrant', check: qdrant },
  ];
}

describe('health routes', () => {
  it('keeps liveness independent from dependencies', async () => {
    const database = vi.fn().mockRejectedValue(new Error('offline'));
    const qdrant = vi.fn().mockRejectedValue(new Error('offline'));
    const app = await buildTestServer(dependencies(database, qdrant));

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    expect(database).not.toHaveBeenCalled();
    expect(qdrant).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 200 when PostgreSQL and Qdrant are ready', async () => {
    const app = await buildTestServer(
      dependencies(vi.fn().mockResolvedValue(undefined), vi.fn().mockResolvedValue(undefined)),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      checks: {
        database: { status: 'up' },
        qdrant: { status: 'up' },
      },
    });
    await app.close();
  });

  it('returns 503 with component diagnostics when a dependency fails', async () => {
    const app = await buildTestServer(
      dependencies(
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockRejectedValue(new TypeError('private qdrant URL')),
      ),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    const body: { checks: { qdrant: { hint?: string } } } = response.json();

    expect(response.statusCode).toBe(503);
    expect(body).toMatchObject({
      status: 'not_ready',
      checks: {
        database: { status: 'up' },
        qdrant: {
          status: 'down',
          error: 'TypeError',
        },
      },
    });
    expect(body.checks.qdrant.hint).toContain('QDRANT_URL');
    expect(response.body).not.toContain('private qdrant URL');
    await app.close();
  });
});
