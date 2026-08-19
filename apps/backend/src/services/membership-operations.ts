import { Prisma, type PrismaClient, type UserRole } from '@prisma/client';
import {
  assertMembershipChangeAllowed,
  type MembershipRole,
  type MembershipStatus,
} from './identity-foundation.js';

const MEMBERSHIP_CHANGE_RETRY_ATTEMPTS = 3;

function isSerializableConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      error.message.includes('write conflict') ||
      error.message.includes('deadlock'))
  );
}

async function lockTenantMemberships(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('membership-owner'))
  `;
}

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MEMBERSHIP_CHANGE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializableConflict(error) || attempt === MEMBERSHIP_CHANGE_RETRY_ATTEMPTS) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

export async function changeMembershipRoleStatus(
  prisma: PrismaClient,
  input: {
    membershipId: string;
    nextRole?: MembershipRole;
    nextStatus?: MembershipStatus;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const membership = await tx.membership.findUnique({
          where: { id: input.membershipId },
        });
        if (!membership) throw new Error('Membership not found');

        await lockTenantMemberships(tx, membership.tenantId);
        const activeOwnerCount = await tx.membership.count({
          where: { tenantId: membership.tenantId, role: 'OWNER', status: 'ACTIVE' },
        });

        assertMembershipChangeAllowed({
          activeOwnerCount,
          currentRole: membership.role,
          currentStatus: membership.status,
          nextRole: input.nextRole,
          nextStatus: input.nextStatus,
        });

        const updated = await tx.membership.update({
          where: { id: membership.id },
          data: {
            ...(input.nextRole ? { role: input.nextRole as UserRole } : {}),
            ...(input.nextStatus ? { status: input.nextStatus } : {}),
          },
        });

        if (updated.status === 'SUSPENDED' || updated.status === 'REMOVED') {
          await tx.authSession.updateMany({
            where: { selectedMembershipId: updated.id, revokedAt: null },
            data: { revokedAt: now },
          });
        }

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
