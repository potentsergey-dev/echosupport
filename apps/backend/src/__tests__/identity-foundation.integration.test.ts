import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashOpaqueToken, normalizeEmail } from '../services/identity-foundation.js';
import { changeMembershipRoleStatus } from '../services/membership-operations.js';
import { prisma } from '../db/prisma.js';

async function cleanIdentityFixture() {
  await prisma.auditLog.deleteMany();
  await prisma.workspaceInvitation.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.externalIdentity.deleteMany();
  await prisma.tenantPlanAssignment.deleteMany();
  await prisma.workspaceOnboardingState.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
}

describe('Phase 2 identity foundation (PostgreSQL)', () => {
  beforeEach(async () => {
    await cleanIdentityFixture();
  });

  afterAll(async () => {
    await cleanIdentityFixture();
    await prisma.$disconnect();
  });

  it('allows one global user to belong to two workspaces through memberships', async () => {
    const [tenantA, tenantB] = await Promise.all([
      prisma.tenant.create({ data: { name: 'Workspace A' } }),
      prisma.tenant.create({ data: { name: 'Workspace B' } }),
    ]);
    const user = await prisma.user.create({
      data: {
        tenantId: tenantA.id,
        email: 'owner@example.com',
        normalizedEmail: normalizeEmail('owner@example.com'),
        emailVerified: true,
        passwordHash: 'legacy-password-hash',
        role: 'OWNER',
      },
    });

    await prisma.membership.createMany({
      data: [
        { userId: user.id, tenantId: tenantA.id, role: 'OWNER', status: 'ACTIVE' },
        { userId: user.id, tenantId: tenantB.id, role: 'ADMIN', status: 'ACTIVE' },
      ],
    });

    const memberships = await prisma.membership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      orderBy: { tenantId: 'asc' },
    });

    expect(memberships).toHaveLength(2);
    expect(memberships.map((membership) => membership.role).sort()).toEqual(['ADMIN', 'OWNER']);
    expect(user.tenantId).toBe(tenantA.id);
  });

  it('keeps a global user and other memberships when the legacy home tenant is deleted', async () => {
    const [homeTenant, otherTenant] = await Promise.all([
      prisma.tenant.create({ data: { name: 'Legacy Home' } }),
      prisma.tenant.create({ data: { name: 'Other Workspace' } }),
    ]);
    const user = await prisma.user.create({
      data: {
        tenantId: homeTenant.id,
        email: 'multi@example.com',
        normalizedEmail: normalizeEmail('multi@example.com'),
        emailVerified: true,
        passwordHash: 'legacy-password-hash',
        role: 'OWNER',
      },
    });
    await prisma.membership.createMany({
      data: [
        { userId: user.id, tenantId: homeTenant.id, role: 'OWNER', status: 'ACTIVE' },
        { userId: user.id, tenantId: otherTenant.id, role: 'ADMIN', status: 'ACTIVE' },
      ],
    });

    await prisma.tenant.delete({ where: { id: homeTenant.id } });

    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toMatchObject({
      tenantId: null,
    });
    await expect(
      prisma.membership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId: otherTenant.id } },
      }),
    ).resolves.toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
    await expect(
      prisma.membership.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId: homeTenant.id } },
      }),
    ).resolves.toBeNull();
  });

  it('enforces normalizedEmail uniqueness across case and surrounding spaces', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Email Workspace' } });
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'Owner@Example.com',
        normalizedEmail: normalizeEmail(' Owner@Example.com '),
        emailVerified: true,
        role: 'OWNER',
      },
    });

    await expect(
      prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: ' owner@example.COM ',
          normalizedEmail: normalizeEmail(' owner@example.COM '),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
    ).rejects.toThrow();
  });

  it('keeps external identities provider-neutral and unique by provider subject', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Workspace' } });
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'identity@example.com',
        normalizedEmail: normalizeEmail('identity@example.com'),
        emailVerified: true,
        role: 'OWNER',
      },
    });

    await prisma.externalIdentity.create({
      data: {
        userId: user.id,
        provider: 'google-identity-platform',
        subject: 'firebase-uid-1',
        email: user.email,
      },
    });

    await expect(
      prisma.externalIdentity.create({
        data: {
          userId: user.id,
          provider: 'google-identity-platform',
          subject: 'firebase-uid-1',
          email: user.email,
        },
      }),
    ).rejects.toThrow();
  });

  it('accepts invitation tokens once and only for the matching normalized email', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Invite Workspace' } });
    const inviter = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@example.com',
        normalizedEmail: normalizeEmail('owner@example.com'),
        emailVerified: true,
        passwordHash: 'legacy-password-hash',
        role: 'OWNER',
      },
    });
    const invitedUser = await prisma.user.create({
      data: {
        email: 'member@example.com',
        normalizedEmail: normalizeEmail('member@example.com'),
        emailVerified: true,
        role: 'OPERATOR',
      },
    });
    const tokenHash = hashOpaqueToken('raw-invitation-token');
    await prisma.workspaceInvitation.create({
      data: {
        workspaceId: tenant.id,
        email: normalizeEmail('MEMBER@example.com'),
        role: 'OPERATOR',
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        invitedById: inviter.id,
      },
    });

    async function acceptInvitation(email: string) {
      return prisma.$transaction(async (tx) => {
        const invitation = await tx.workspaceInvitation.findFirst({
          where: {
            tokenHash,
            email: normalizeEmail(email),
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        });
        if (!invitation) return false;
        await tx.membership.upsert({
          where: { userId_tenantId: { userId: invitedUser.id, tenantId: invitation.workspaceId } },
          update: { role: invitation.role, status: 'ACTIVE' },
          create: {
            userId: invitedUser.id,
            tenantId: invitation.workspaceId,
            role: invitation.role,
            status: 'ACTIVE',
          },
        });
        const accepted = await tx.workspaceInvitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: new Date() },
        });
        return accepted.count === 1;
      });
    }

    await expect(acceptInvitation('other@example.com')).resolves.toBe(false);
    await expect(acceptInvitation('member@example.com')).resolves.toBe(true);
    await expect(acceptInvitation('member@example.com')).resolves.toBe(false);
    await expect(
      prisma.membership.findUnique({
        where: { userId_tenantId: { userId: invitedUser.id, tenantId: tenant.id } },
      }),
    ).resolves.toMatchObject({ role: 'OPERATOR', status: 'ACTIVE' });
  });

  it('revokes selected sessions when a membership is removed', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Session Workspace' } });
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'session@example.com',
        normalizedEmail: normalizeEmail('session@example.com'),
        emailVerified: true,
        passwordHash: 'legacy-password-hash',
        role: 'ADMIN',
      },
    });
    const membership = await prisma.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: 'ADMIN', status: 'ACTIVE' },
    });
    const authSession = await prisma.authSession.create({
      data: {
        tokenHash: hashOpaqueToken('session-token'),
        userId: user.id,
        tenantId: tenant.id,
        selectedMembershipId: membership.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await changeMembershipRoleStatus(prisma, {
      membershipId: membership.id,
      nextStatus: 'REMOVED',
    });

    const revokedSession = await prisma.authSession.findUnique({ where: { id: authSession.id } });
    expect(revokedSession?.revokedAt).toBeInstanceOf(Date);
  });

  it('protects the last active OWNER under concurrent membership changes', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Owner Race Workspace' } });
    const [firstUser, secondUser] = await Promise.all([
      prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: 'owner-race-a@example.com',
          normalizedEmail: normalizeEmail('owner-race-a@example.com'),
          emailVerified: true,
          role: 'OWNER',
        },
      }),
      prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: 'owner-race-b@example.com',
          normalizedEmail: normalizeEmail('owner-race-b@example.com'),
          emailVerified: true,
          role: 'OWNER',
        },
      }),
    ]);
    const [firstMembership, secondMembership] = await Promise.all([
      prisma.membership.create({
        data: { userId: firstUser.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' },
      }),
      prisma.membership.create({
        data: { userId: secondUser.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' },
      }),
    ]);

    const results = await Promise.allSettled([
      changeMembershipRoleStatus(prisma, { membershipId: firstMembership.id, nextRole: 'ADMIN' }),
      changeMembershipRoleStatus(prisma, { membershipId: secondMembership.id, nextRole: 'ADMIN' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(
      prisma.membership.count({
        where: { tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' },
      }),
    ).resolves.toBe(1);
  });
});
