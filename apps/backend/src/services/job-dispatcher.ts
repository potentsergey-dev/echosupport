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
      const job = await db.job.upsert({
        where: { dedupeKey },
        create: { ...data, dedupeKey },
        update: {},
        select: { id: true, type: true, payload: true, agentId: true, scheduledAt: true },
      });
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
