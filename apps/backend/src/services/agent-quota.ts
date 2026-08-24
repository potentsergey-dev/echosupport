import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type {
  EntitlementContext,
  EntitlementSnapshot,
  QuotaKey,
} from '../contracts/entitlements.js';

/**
 * Shared atomic agent creation with quota enforcement.
 * Used by both the admin agents route and the onboarding draft-agent route so
 * quota cannot be bypassed and concurrent creations are serialized per tenant
 * via a Postgres advisory lock.
 */

const SERIALIZABLE_RETRY_ATTEMPTS = 3;

export interface EntitlementsLike {
  assertQuota(
    ctx: EntitlementContext,
    quota: QuotaKey,
    delta: number,
    countFn: () => Promise<number>,
  ): Promise<EntitlementSnapshot>;
}

async function lockTenantQuota(
  tx: Prisma.TransactionClient,
  tenantId: string,
  quota: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${quota}))
  `;
}

function isSerializableConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      error.message.includes('write conflict') ||
      error.message.includes('deadlock'))
  );
}

export async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializableConflict(error) || attempt === SERIALIZABLE_RETRY_ATTEMPTS) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

export interface CreateAgentWithQuotaInput {
  tenantId: string;
  userId: string;
  data: Prisma.AgentUncheckedCreateInput;
  select?: Prisma.AgentSelect;
}

/**
 * Creates an agent inside a serializable transaction guarded by a per-tenant
 * advisory lock, enforcing the `agents` quota via the entitlements service.
 */
export async function createAgentWithQuota(
  prisma: PrismaClient,
  entitlements: EntitlementsLike,
  input: CreateAgentWithQuotaInput,
) {
  return withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockTenantQuota(tx, input.tenantId, 'agents');
        await entitlements.assertQuota(
          { tenantId: input.tenantId, userId: input.userId },
          'agents',
          1,
          () => tx.agent.count({ where: { tenantId: input.tenantId } }),
        );
        return tx.agent.create({
          data: input.data,
          ...(input.select ? { select: input.select } : {}),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
