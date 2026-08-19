import { prisma } from './prisma.js';

async function main() {
  const users = await prisma.user.findMany({
    where: { id: { startsWith: 'phase2-legacy-' } },
    include: { memberships: true },
    orderBy: { id: 'asc' },
  });

  if (users.length !== 3) {
    throw new Error(`Expected 3 legacy users after upgrade, got ${users.length}.`);
  }

  for (const user of users) {
    if (!user.tenantId) throw new Error(`Legacy user ${user.id} lost tenantId during expand.`);
    if (!user.passwordHash) throw new Error(`Legacy user ${user.id} lost passwordHash.`);
    if (!user.normalizedEmail) throw new Error(`Legacy user ${user.id} missing normalizedEmail.`);
    if (user.normalizedEmail !== user.email.trim().toLowerCase()) {
      throw new Error(`Legacy user ${user.id} has incorrect normalizedEmail.`);
    }
    const homeMembership = user.memberships.find(
      (membership) => membership.tenantId === user.tenantId,
    );
    if (!homeMembership) throw new Error(`Legacy user ${user.id} missing home membership.`);
    if (homeMembership.role !== user.role) {
      throw new Error(
        `Legacy user ${user.id} membership role ${homeMembership.role} does not match ${user.role}.`,
      );
    }
    if (homeMembership.status !== 'ACTIVE') {
      throw new Error(`Legacy user ${user.id} membership is not ACTIVE.`);
    }
  }

  const agents = await prisma.agent.findMany({
    where: { id: { startsWith: 'phase2-legacy-' } },
    orderBy: { id: 'asc' },
  });
  const active = agents.find((agent) => agent.id === 'phase2-legacy-active-agent');
  const archived = agents.find((agent) => agent.id === 'phase2-legacy-archived-agent');
  if (active?.lifecycleStatus !== 'ACTIVE' || active.isActive !== true) {
    throw new Error('Legacy active agent did not backfill to ACTIVE lifecycle.');
  }
  if (archived?.lifecycleStatus !== 'ARCHIVED' || archived.isActive !== false) {
    throw new Error('Legacy inactive agent did not backfill to ARCHIVED lifecycle.');
  }

  const activePlanCount = await prisma.tenantPlanAssignment.count({
    where: { tenantId: { in: ['phase2-legacy-tenant-a', 'phase2-legacy-tenant-b'] } },
  });
  if (activePlanCount !== 2) {
    throw new Error(`Expected two compatibility plan assignments, got ${activePlanCount}.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
