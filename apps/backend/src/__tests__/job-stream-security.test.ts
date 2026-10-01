/* eslint-disable @typescript-eslint/unbound-method */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../db/prisma.js', () => ({
  prisma: {
    job: { findUnique: vi.fn(), findFirst: vi.fn() },
    agent: { findFirst: vi.fn() },
  },
}));
import { prisma } from '../db/prisma.js';
import jobRoutes from '../routes/admin/jobs.js';
import authPlugin from '../plugins/auth.js';

const context = {
  userId: 'owner',
  tenantId: 'tenant-a',
  membershipId: 'membership-a',
  email: 'a@example.com',
  role: 'OWNER' as const,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.job.findUnique).mockResolvedValue({
    id: 'job',
    agentId: 'agent',
    status: 'DONE',
    progress: 100,
    errorMessage: 'protected detail',
  } as never);
  vi.mocked(prisma.agent.findFirst).mockResolvedValue({ id: 'agent' } as never);
});

describe('job stream access', () => {
  it.each([
    'logout',
    'removed',
    'suspended',
    'expired',
    'workspace-switch',
    'role-change',
    'store-outage',
  ])(
    'stops protected delivery after %s',
    async (reason) => {
      const authenticateRequest = vi.fn().mockResolvedValueOnce(context);
      if (reason === 'workspace-switch')
        authenticateRequest.mockResolvedValue({
          ...context,
          tenantId: 'tenant-b',
          membershipId: 'membership-b',
        });
      else if (reason === 'role-change')
        authenticateRequest.mockResolvedValue({ ...context, role: 'OPERATOR' });
      else authenticateRequest.mockRejectedValue(new Error(reason));
      const app = Fastify();
      app.decorate('deps', { authWorkspace: { authenticateRequest } } as never);
      await app.register(authPlugin);
      await app.register(jobRoutes);
      try {
        const response = await app.inject('/jobs/job/stream');
        expect(response.statusCode).toBe(200);
        expect(response.body).not.toContain('progress');
        expect(response.body).not.toContain('protected detail');
        expect(authenticateRequest).toHaveBeenLastCalledWith(expect.anything(), {
          touchSession: false,
        });
      } finally {
        await app.close();
      }
    },
    5000,
  );
  it('delivers the real terminal state once access is still valid', async () => {
    const app = Fastify();
    app.decorate('deps', {
      authWorkspace: { authenticateRequest: vi.fn().mockResolvedValue(context) },
    } as never);
    await app.register(authPlugin);
    await app.register(jobRoutes);
    try {
      const response = await app.inject('/jobs/job/stream');
      expect(response.body).toContain('event: done');
      expect(response.body).toContain('"status":"DONE"');
    } finally {
      await app.close();
    }
  });
  it('discovers jobs only after checking agent ownership', async () => {
    const app = Fastify();
    app.decorate('deps', {
      authWorkspace: { authenticateRequest: vi.fn().mockResolvedValue(context) },
    } as never);
    await app.register(authPlugin);
    await app.register(jobRoutes);
    try {
      vi.mocked(prisma.agent.findFirst).mockResolvedValueOnce(null);
      expect((await app.inject('/agents/other/indexing-job')).statusCode).toBe(404);
      expect(prisma.job.findFirst).not.toHaveBeenCalled();
      vi.mocked(prisma.job.findFirst).mockResolvedValueOnce({
        id: 'running-job',
        status: 'RUNNING',
      } as never);
      const response = await app.inject('/agents/agent/indexing-job');
      expect(response.json()).toEqual({ id: 'running-job', status: 'RUNNING' });
      expect(prisma.job.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            agentId: 'agent',
            type: 'REINDEX_AGENT',
            status: { in: ['PENDING', 'RUNNING'] },
          },
        }),
      );
    } finally {
      await app.close();
    }
  });
});
