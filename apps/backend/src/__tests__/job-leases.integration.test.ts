import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { createJobLeaseService } from '../services/job-leases.js';

const leases = createJobLeaseService(prisma);
const created: string[] = [];

async function createJob(options: { scheduledAt?: Date; status?: 'PENDING' | 'RUNNING' } = {}) {
  const job = await prisma.job.create({
    data: {
      type: 'SUMMARIZE_SESSION',
      payload: { sessionId: 'lease-test-session' },
      ...(options.scheduledAt ? { scheduledAt: options.scheduledAt } : {}),
      ...(options.status ? { status: options.status } : {}),
    },
  });
  created.push(job.id);
  return job;
}

describe('job leases (PostgreSQL)', () => {
  afterEach(async () => {
    await prisma.job.deleteMany({ where: { id: { in: created } } });
    created.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('does not claim a job before its scheduled time', async () => {
    const job = await createJob({ scheduledAt: new Date(Date.now() + 60_000) });
    expect(await leases.claimNext(job.id)).toBeNull();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('PENDING');
  });

  it('allows only one concurrent claimant for one due job', async () => {
    const job = await createJob({ scheduledAt: new Date(Date.now() - 60_000) });
    const claims = await Promise.all([leases.claimNext(job.id), leases.claimNext(job.id)]);
    const winners = claims.filter((claim) => claim !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.job.id).toBe(job.id);
    expect(winners[0]!.job.attemptCount).toBe(1);
    expect(await leases.claimNext(job.id)).toBeNull();
  });

  it('reclaims an expired lease and rejects the old worker token', async () => {
    const job = await createJob();
    const first = await leases.claimNext(job.id);
    expect(first?.job.id).toBe(job.id);
    await prisma.job.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });
    const second = await leases.claimNext(job.id);
    expect(second?.job.id).toBe(job.id);
    expect(second?.job.attemptCount).toBe(2);
    expect(second?.token).not.toBe(first?.token);
    await expect(leases.renew(job.id, first!.token)).rejects.toThrow('Job lease lost');
    await expect(leases.finish(job.id, first!.token)).rejects.toThrow('Job lease lost');
    await leases.finish(job.id, second!.token);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'DONE',
      progress: 100,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    expect(await leases.claimNext(job.id)).toBeNull();
  });

  it('reclaims legacy RUNNING rows without a lease after old workers have stopped', async () => {
    const job = await createJob({ status: 'RUNNING' });
    const claim = await leases.claimNext(job.id);
    expect(claim?.job.id).toBe(job.id);
    expect(claim?.job.attemptCount).toBe(1);
  });

  it('renews a live lease and never renews or finishes an expired lease', async () => {
    const job = await createJob();
    const claim = await leases.claimNext(job.id);
    await prisma.job.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() + 10_000) },
    });
    await leases.renew(job.id, claim!.token);
    const renewed = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(renewed.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 30_000);
    await prisma.job.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(leases.renew(job.id, claim!.token)).rejects.toThrow('Job lease lost');
    await expect(leases.finish(job.id, claim!.token)).rejects.toThrow('Job lease lost');
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('RUNNING');
  });

  it('records a failed attempt as terminal and does not claim it again', async () => {
    const job = await createJob();
    const claim = await leases.claimNext(job.id);
    await leases.finish(job.id, claim!.token, 'sanitized failure');
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'FAILED',
      errorMessage: 'sanitized failure',
      leaseToken: null,
      leaseExpiresAt: null,
    });
    expect(await leases.claimNext(job.id)).toBeNull();
  });
});
