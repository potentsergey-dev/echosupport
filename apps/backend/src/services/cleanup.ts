import { prisma } from '../db/prisma.js';

// Advisory lock key used to prevent duplicate cleanup across multiple instances
const CLEANUP_ADVISORY_LOCK = 42n;

export async function cleanupExpiredSessions(): Promise<number> {
  // Try to acquire a PG session-level advisory lock
  const lockResult = await prisma.$queryRaw<[{ pg_try_advisory_lock: boolean }]>`
    SELECT pg_try_advisory_lock(${CLEANUP_ADVISORY_LOCK})
  `;

  const acquired = lockResult[0]?.pg_try_advisory_lock;
  if (!acquired) {
    // Another instance is running cleanup — skip this cycle
    return 0;
  }

  try {
    const deleted = await prisma.$executeRaw`
      DELETE FROM "Session"
      WHERE "expiresAt" < NOW()
    `;
    return deleted;
  } finally {
    // Always release the advisory lock
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${CLEANUP_ADVISORY_LOCK})`;
  }
}

export function startCleanupRunner(): NodeJS.Timeout {
  const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  return setInterval(() => {
    cleanupExpiredSessions()
      .then((count) => {
        if (count > 0) {
          console.info(`[cleanup] Cleaned up ${String(count)} expired sessions`);
        }
      })
      .catch((err) => {
        console.error('[cleanup] Unexpected error during session cleanup:', err);
      });
  }, INTERVAL_MS);
}
