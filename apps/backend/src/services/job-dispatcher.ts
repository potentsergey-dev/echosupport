import { isDeepStrictEqual } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import type { JobDispatcher } from '../contracts/infrastructure.js';
import { prisma } from '../db/prisma.js';

export function createPrismaJobDispatcher(db: PrismaClient): JobDispatcher {
  return {
    async enqueue(type, payload, options) {
      const dedupeKey = options?.dedupeKey?.trim();
      if (options?.dedupeKey !== undefined && !dedupeKey) {
        throw new Error('Job dedupe key must not be empty');
      }
      const data = {
        type,
        payload,
        agentId: options?.agentId ?? null,
        scheduledAt: options?.runAt ?? new Date(),
      };
      if (!dedupeKey) {
        return db.job.create({ data, select: { id: true } });
      }
      const select = {
        id: true,
        type: true,
        payload: true,
        agentId: true,
        scheduledAt: true,
      } as const;
      let job;
      try {
        job = await db.job.create({ data: { ...data, dedupeKey }, select });
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'P2002')) {
          throw error;
        }
        job = await db.job.findUnique({ where: { dedupeKey }, select });
        if (!job) throw error;
      }
      if (
        job.type !== type ||
        !isDeepStrictEqual(job.payload, payload) ||
        job.agentId !== (options?.agentId ?? null) ||
        (options?.runAt && job.scheduledAt.getTime() !== options.runAt.getTime())
      ) {
        throw new Error('Job dedupe key reused with different parameters');
      }
      return { id: job.id };
    },
  };
}

export const prismaJobDispatcher = createPrismaJobDispatcher(prisma);
