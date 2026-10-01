import { prisma } from '../db/prisma.js';
import { sanitizeErrorMessage } from './error-sanitizer.js';
import { reindexAgent } from './indexer.js';
import { summarizeSession } from './conversation-summarizer.js';
import { createJobLeaseService } from './job-leases.js';
import type { StorageAdapter, WorkerRunner } from '../contracts/infrastructure.js';

let busy = false;
const leases = createJobLeaseService(prisma);

async function processNextJob(
  storage: Pick<StorageAdapter, 'readFile' | 'readFileVersion'>,
  onlyJobId?: string,
): Promise<'DONE' | 'FAILED' | null> {
  if (busy) return null;
  busy = true;

  try {
    const claim = await leases.claimNext(onlyJobId);
    if (!claim) return null;
    const { job, token } = claim;
    let renewalError: unknown;
    let renewal = Promise.resolve();
    const heartbeat = setInterval(() => {
      renewal = renewal.then(async () => {
        if (renewalError) return;
        try {
          await leases.renew(job.id, token);
        } catch (error) {
          renewalError = error;
        }
      });
    }, 20_000);

    let processingError: unknown;
    try {
      if (job.type === 'REINDEX_AGENT') {
        const { agentId } = job.payload as { agentId: string };
        await reindexAgent(agentId, job.id, storage, token);
      } else if (job.type === 'SUMMARIZE_SESSION') {
        const { sessionId } = job.payload as { sessionId: string };
        await summarizeSession(sessionId, { jobId: job.id, token });
      } else {
        throw new Error(`Unsupported job type: ${job.type}`);
      }
    } catch (error) {
      processingError = error;
    } finally {
      clearInterval(heartbeat);
      await renewal;
    }

    if (renewalError) throw renewalError;
    await leases.finish(
      job.id,
      token,
      processingError === undefined ? undefined : sanitizeErrorMessage(processingError),
    );
    return processingError === undefined ? 'DONE' : 'FAILED';
  } catch (err: unknown) {
    console.error('[job-runner] Job claim or lease failed:', sanitizeErrorMessage(err));
    if (onlyJobId) throw err;
    return null;
  } finally {
    busy = false;
  }
}

export async function runJobOnce(
  jobId: string,
  storage: Pick<StorageAdapter, 'readFile' | 'readFileVersion'>,
): Promise<void> {
  if (!jobId.trim()) throw new Error('JOB_ID is required');
  const result = await processNextJob(storage, jobId);
  if (result !== 'DONE') {
    throw new Error(result === 'FAILED' ? 'Job failed' : 'Job is not claimable');
  }
}

export function startJobRunner(
  storage: Pick<StorageAdapter, 'readFile' | 'readFileVersion'>,
): NodeJS.Timeout {
  return setInterval(() => {
    processNextJob(storage).catch((err) =>
      console.error('[job-runner] Unexpected error:', sanitizeErrorMessage(err)),
    );
  }, 5_000);
}

export function createPrismaJobWorkerRunner(
  storage: Pick<StorageAdapter, 'readFile' | 'readFileVersion'>,
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
