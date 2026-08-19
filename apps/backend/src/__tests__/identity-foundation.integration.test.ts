import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashOpaqueToken, normalizeEmail } from '../services/identity-foundation.js';
import { prisma } from '../db/prisma.js';

async function cleanIdentityFixture() {
  await prisma.auditLog.deleteMany();
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

    await prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { status: 'REMOVED' },
      });
      await tx.authSession.updateMany({
        where: { selectedMembershipId: membership.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    const revokedSession = await prisma.authSession.findUnique({ where: { id: authSession.id } });
    expect(revokedSession?.revokedAt).toBeInstanceOf(Date);
  });
});
