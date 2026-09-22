import { randomUUID } from 'node:crypto';
import type { IndexGeneration } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import {
  deleteByIndexGeneration,
  deleteLegacyAgentPoints,
} from '../adapters/vectorstore/qdrant.js';
import { sanitizeErrorMessage } from './error-sanitizer.js';

const RETENTION_MS = 24 * 60 * 60 * 1000;
const JOURNAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_LEASE_MS = 30 * 60 * 1000;
const INTERVAL_MS = 15 * 60 * 1000;

async function claimCleanup(
  candidate: IndexGeneration,
): Promise<{ row: IndexGeneration; token: string } | null> {
  return prisma.$transaction(async (tx) => {
    const [job] = await tx.$queryRaw<
      Array<{
        status: string;
        leaseToken: string | null;
        leaseExpiresAt: Date | null;
      }>
    >`SELECT status, "leaseToken", "leaseExpiresAt" FROM "Job" WHERE id = ${candidate.jobId} FOR UPDATE`;
    const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0]!.now;
    const row = await tx.indexGeneration.findUnique({ where: { id: candidate.id } });
    if (!row || row.cleanedAt || (row.cleanupLeaseExpiresAt && row.cleanupLeaseExpiresAt > now))
      return null;

    const cutoff = new Date(now.getTime() - RETENTION_MS);
    if (row.publishedAt ? !row.retiredAt || row.retiredAt > cutoff : row.createdAt > cutoff)
      return null;
    if (
      !row.publishedAt &&
      job?.status === 'RUNNING' &&
      job.leaseToken === row.leaseToken &&
      job.leaseExpiresAt &&
      job.leaseExpiresAt > now
    )
      return null;

    const agent = await tx.agent.findUnique({
      where: { id: row.agentId },
      select: { activeIndexGeneration: true },
    });
    if (
      agent &&
      (row.legacy ? agent.activeIndexGeneration === null : agent.activeIndexGeneration === row.id)
    )
      return null;

    const token = randomUUID();
    const claimed = await tx.indexGeneration.updateMany({
      where: {
        id: row.id,
        cleanedAt: null,
        OR: [{ cleanupLeaseExpiresAt: null }, { cleanupLeaseExpiresAt: { lte: now } }],
      },
      data: {
        cleanupToken: token,
        cleanupLeaseExpiresAt: new Date(now.getTime() + CLEANUP_LEASE_MS),
      },
    });
    return claimed.count === 1 ? { row, token } : null;
  });
}

export async function cleanupIndexGenerations(limit = 100): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  let cleaned = 0;
  let cursor: string | undefined;
  const pageSize = Math.max(1, Math.min(limit, 100));
  for (let page = 0; page < 10 && cleaned < limit; page++) {
    const candidates = await prisma.indexGeneration.findMany({
      where: {
        cleanedAt: null,
        OR: [{ retiredAt: { lte: cutoff } }, { publishedAt: null, createdAt: { lte: cutoff } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (candidates.length === 0) break;
    cursor = candidates[candidates.length - 1]!.id;
    for (const candidate of candidates) {
      if (cleaned >= limit) break;
      let claim: { row: IndexGeneration; token: string } | null = null;
      try {
        claim = await claimCleanup(candidate);
        if (!claim) continue;
        const { row, token } = claim;
        if (row.legacy) {
          await deleteLegacyAgentPoints(row.tenantId, row.agentId);
        } else {
          await deleteByIndexGeneration(row.tenantId, row.agentId, row.id);
        }
        await prisma.documentChunk.deleteMany({
          where: { agentId: row.agentId, indexGeneration: row.legacy ? null : row.id },
        });
        const result = await prisma.indexGeneration.updateMany({
          where: { id: row.id, cleanupToken: token },
          data: { cleanedAt: new Date(), cleanupToken: null, cleanupLeaseExpiresAt: null },
        });
        cleaned += result.count;
      } catch (error: unknown) {
        console.warn('[index-cleanup] Generation cleanup failed:', sanitizeErrorMessage(error));
        if (claim) {
          await prisma.indexGeneration
            .updateMany({
              where: { id: claim.row.id, cleanupToken: claim.token },
              data: { cleanupToken: null, cleanupLeaseExpiresAt: null },
            })
            .catch((releaseError: unknown) =>
              console.warn(
                '[index-cleanup] Cleanup claim release failed:',
                sanitizeErrorMessage(releaseError),
              ),
            );
        }
      }
    }
    if (candidates.length < pageSize) break;
  }
  await prisma.indexGeneration.deleteMany({
    where: { cleanedAt: { lt: new Date(Date.now() - JOURNAL_RETENTION_MS) } },
  });
  return cleaned;
}

export function startIndexCleanupRunner(): { stop(): Promise<void> } {
  let running: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (running) return;
    running = cleanupIndexGenerations()
      .then((count) => {
        if (count > 0) console.info(`[index-cleanup] Removed ${String(count)} old generations`);
      })
      .catch((error: unknown) =>
        console.error('[index-cleanup] Unexpected error:', sanitizeErrorMessage(error)),
      )
      .finally(() => {
        running = null;
      });
  }, INTERVAL_MS);
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
