import { prisma } from '../db/prisma.js';
import { sanitizeErrorMessage } from './error-sanitizer.js';
import { reindexAgent } from './indexer.js';
import { summarizeSession } from './conversation-summarizer.js';
import type { JobDispatcher, StorageAdapter, WorkerRunner } from '../contracts/infrastructure.js';

let busy = false;

async function processNextJob(storage: Pick<StorageAdapter, 'readFile'>): Promise<void> {
  if (busy) return;

  let jobId: string | null = null;
  let jobType: string | null = null;
  let jobPayload: unknown = null;

  try {
    await prisma.$transaction(async (tx) => {
      type JobRow = { id: string; type: string; payload: unknown };
      const rows = await tx.$queryRaw<JobRow[]>`
        SELECT id, type, payload FROM "Job"
        WHERE status = 'PENDING'
        ORDER BY "scheduledAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return;

      const job = rows[0]!;
      await tx.$executeRaw`
        UPDATE "Job"
        SET status = 'RUNNING', "startedAt" = NOW()
        WHERE id = ${job.id}
      `;

      jobId = job.id;
      jobType = job.type;
      jobPayload = job.payload;
    });
  } catch (err) {
    console.error('[job-runner] Failed to claim job:', sanitizeErrorMessage(err));
    return;
  }

  if (!jobId || !jobType) return;

  busy = true;
  try {
    if (jobType === 'REINDEX_AGENT') {
      const { agentId } = jobPayload as { agentId: string };
      await reindexAgent(agentId, jobId, storage);
    } else if (jobType === 'SUMMARIZE_SESSION') {
      const { sessionId } = jobPayload as { sessionId: string };
      await summarizeSession(sessionId);
    }

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'DONE', progress: 100, finishedAt: new Date() },
    });
  } catch (err: unknown) {
    await prisma.job
      .update({
        where: { id: jobId },
        data: { status: 'FAILED', errorMessage: sanitizeErrorMessage(err), finishedAt: new Date() },
      })
      .catch(() => undefined);
  } finally {
    busy = false;
  }
}

export function startJobRunner(storage: Pick<StorageAdapter, 'readFile'>): NodeJS.Timeout {
  return setInterval(() => {
    processNextJob(storage).catch((err) =>
      console.error('[job-runner] Unexpected error:', sanitizeErrorMessage(err)),
    );
  }, 5_000);
}

export const prismaJobDispatcher: JobDispatcher = {
  async enqueue(type, payload, options) {
    const job = await prisma.job.create({
      data: {
        type,
        payload,
        agentId: options?.agentId ?? null,
        scheduledAt: options?.runAt ?? new Date(),
      },
      select: { id: true },
    });
    return job;
  },
};

export function createPrismaJobWorkerRunner(
  storage: Pick<StorageAdapter, 'readFile'>,
): WorkerRunner {
  return {
    async start() {
      const timer = startJobRunner(storage);
      return {
        async stop() {
          clearInterval(timer);
        },
      };
    },
  };
}

export function createNoopWorkerRunner(): WorkerRunner {
  return {
    async start() {
      return {
        async stop() {
          return undefined;
        },
      };
    },
  };
}
