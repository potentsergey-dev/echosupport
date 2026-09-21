import { randomUUID } from 'node:crypto';
import type { Job, Prisma, PrismaClient } from '@prisma/client';

const LEASE_MS = 60_000;

export class JobLeaseLostError extends Error {
  constructor() {
    super('Job lease lost');
  }
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return row!.now;
}

async function lockJob(tx: Prisma.TransactionClient, id: string): Promise<Job> {
  const [job] = await tx.$queryRaw<Job[]>`SELECT * FROM "Job" WHERE id = ${id} FOR UPDATE`;
  if (!job) throw new JobLeaseLostError();
  return job;
}

function assertLease(job: Job, token: string, now: Date): void {
  if (
    job.status !== 'RUNNING' ||
    job.leaseToken !== token ||
    !job.leaseExpiresAt ||
    job.leaseExpiresAt <= now
  ) {
    throw new JobLeaseLostError();
  }
}

export function createJobLeaseService(db: PrismaClient) {
  return {
    async withLease<T>(
      id: string,
      token: string,
      work: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
      return db.$transaction(async (tx) => {
        const job = await lockJob(tx, id);
        assertLease(job, token, await databaseNow(tx));
        return work(tx);
      });
    },

    async claimNext(onlyId?: string): Promise<{ job: Job; token: string } | null> {
      return db.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Job"
          WHERE (${onlyId ?? null}::text IS NULL OR id = ${onlyId ?? null})
            AND ((status = 'PENDING' AND "scheduledAt" <= clock_timestamp())
              OR (status = 'RUNNING' AND
                  ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= clock_timestamp())))
          ORDER BY "scheduledAt" ASC, id ASC
          LIMIT 1 FOR UPDATE SKIP LOCKED
        `;
        if (!row) return null;
        const now = await databaseNow(tx);
        const token = randomUUID();
        const job = await tx.job.update({
          where: { id: row.id },
          data: {
            status: 'RUNNING',
            leaseToken: token,
            leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
            attemptCount: { increment: 1 },
            startedAt: now,
            finishedAt: null,
            errorMessage: null,
          },
        });
        return { job, token };
      });
    },

    async renew(id: string, token: string): Promise<void> {
      await db.$transaction(async (tx) => {
        const job = await lockJob(tx, id);
        const now = await databaseNow(tx);
        assertLease(job, token, now);
        await tx.job.update({
          where: { id },
          data: { leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
        });
      });
    },

    async finish(id: string, token: string, errorMessage?: string): Promise<void> {
      await db.$transaction(async (tx) => {
        const job = await lockJob(tx, id);
        const now = await databaseNow(tx);
        assertLease(job, token, now);
        await tx.job.update({
          where: { id },
          data: {
            status: errorMessage === undefined ? 'DONE' : 'FAILED',
            ...(errorMessage === undefined ? { progress: 100 } : { errorMessage }),
            finishedAt: now,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
      });
    },
  };
}
