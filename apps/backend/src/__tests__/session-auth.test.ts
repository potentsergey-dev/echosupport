import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { PrismaSessionAuthWorkspaceAdapter } from '../services/session-auth.js';
import { hashOpaqueToken } from '../services/identity-foundation.js';

function requestWithCookie(cookie: string | undefined): FastifyRequest {
  return { headers: { cookie } } as FastifyRequest;
}

describe('PrismaSessionAuthWorkspaceAdapter', () => {
  it('authenticates an opaque cookie session through an active membership', async () => {
    const now = new Date('2026-08-19T12:00:00.000Z');
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      authSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'session-1',
          tokenHash: hashOpaqueToken('raw-session-token'),
          userId: 'user-1',
          tenantId: 'tenant-1',
          selectedMembershipId: 'membership-1',
          expiresAt: new Date('2026-08-20T12:00:00.000Z'),
          revokedAt: null,
          lastSeenAt: new Date('2026-08-19T11:00:00.000Z'),
          user: { id: 'user-1', email: 'owner@example.com', status: 'ACTIVE' },
          selectedMembership: {
            id: 'membership-1',
            userId: 'user-1',
            tenantId: 'tenant-1',
            role: 'OWNER',
            status: 'ACTIVE',
          },
        }),
        update,
      },
      membership: {
        findUnique: vi.fn(),
      },
    };
    const adapter = new PrismaSessionAuthWorkspaceAdapter(prisma as never, {
      cookieName: 'echosupport_session',
      now: () => now,
    });

    await expect(
      adapter.authenticateRequest(
        requestWithCookie('other=value; echosupport_session=raw-session-token'),
      ),
    ).resolves.toEqual({
      userId: 'user-1',
      email: 'owner@example.com',
      tenantId: 'tenant-1',
      membershipId: 'membership-1',
      role: 'OWNER',
    });
    expect(prisma.authSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashOpaqueToken('raw-session-token') } }),
    );
    expect(update).toHaveBeenCalledWith({ where: { id: 'session-1' }, data: { lastSeenAt: now } });
  });

  it('rejects missing, expired, revoked and membershipless sessions', async () => {
    const adapterWithoutCookie = new PrismaSessionAuthWorkspaceAdapter(
      {
        authSession: { findUnique: vi.fn(), update: vi.fn() },
        membership: { findUnique: vi.fn() },
      } as never,
      { cookieName: 'echosupport_session' },
    );
    await expect(
      adapterWithoutCookie.authenticateRequest(requestWithCookie(undefined)),
    ).rejects.toThrow('Missing session cookie');

    for (const session of [
      null,
      {
        id: 'revoked',
        userId: 'user-1',
        tenantId: 'tenant-1',
        expiresAt: new Date('2026-08-20T00:00:00.000Z'),
        revokedAt: new Date('2026-08-19T00:00:00.000Z'),
        lastSeenAt: new Date('2026-08-19T00:00:00.000Z'),
        user: { id: 'user-1', email: 'owner@example.com', status: 'ACTIVE' },
        selectedMembership: {
          id: 'membership-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          role: 'OWNER',
          status: 'ACTIVE',
        },
      },
      {
        id: 'expired',
        userId: 'user-1',
        tenantId: 'tenant-1',
        expiresAt: new Date('2026-08-18T00:00:00.000Z'),
        revokedAt: null,
        lastSeenAt: new Date('2026-08-19T00:00:00.000Z'),
        user: { id: 'user-1', email: 'owner@example.com', status: 'ACTIVE' },
        selectedMembership: {
          id: 'membership-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          role: 'OWNER',
          status: 'ACTIVE',
        },
      },
      {
        id: 'suspended',
        userId: 'user-1',
        tenantId: 'tenant-1',
        expiresAt: new Date('2026-08-20T00:00:00.000Z'),
        revokedAt: null,
        lastSeenAt: new Date('2026-08-19T00:00:00.000Z'),
        user: { id: 'user-1', email: 'owner@example.com', status: 'ACTIVE' },
        selectedMembership: {
          id: 'membership-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          role: 'OWNER',
          status: 'SUSPENDED',
        },
      },
    ]) {
      const adapter = new PrismaSessionAuthWorkspaceAdapter(
        {
          authSession: { findUnique: vi.fn().mockResolvedValue(session), update: vi.fn() },
          membership: { findUnique: vi.fn() },
        } as never,
        {
          cookieName: 'echosupport_session',
          now: () => new Date('2026-08-19T12:00:00.000Z'),
        },
      );
      await expect(
        adapter.authenticateRequest(requestWithCookie('echosupport_session=raw-session-token')),
      ).rejects.toThrow();
    }
  });

  it('revokes idle sessions before denying authentication', async () => {
    const now = new Date('2026-08-19T12:00:00.000Z');
    const update = vi.fn().mockResolvedValue({});
    const adapter = new PrismaSessionAuthWorkspaceAdapter(
      {
        authSession: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'idle-session',
            userId: 'user-1',
            tenantId: 'tenant-1',
            expiresAt: new Date('2026-08-20T00:00:00.000Z'),
            revokedAt: null,
            lastSeenAt: new Date('2026-08-19T10:00:00.000Z'),
            user: { id: 'user-1', email: 'owner@example.com', status: 'ACTIVE' },
            selectedMembership: {
              id: 'membership-1',
              userId: 'user-1',
              tenantId: 'tenant-1',
              role: 'OWNER',
              status: 'ACTIVE',
            },
          }),
          update,
        },
        membership: { findUnique: vi.fn() },
      } as never,
      { cookieName: 'echosupport_session', idleTtlMs: 60_000, now: () => now },
    );

    await expect(
      adapter.authenticateRequest(requestWithCookie('echosupport_session=raw-session-token')),
    ).rejects.toThrow('Session idle timeout');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'idle-session' },
      data: { revokedAt: now },
    });
  });

  it('checks workspace access against active membership instead of trusting input tenant IDs', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'membership-2', status: 'ACTIVE' })
      .mockResolvedValueOnce({ id: 'membership-3', status: 'REMOVED' })
      .mockResolvedValueOnce(null);
    const adapter = new PrismaSessionAuthWorkspaceAdapter(
      {
        authSession: { findUnique: vi.fn(), update: vi.fn() },
        membership: { findUnique },
      } as never,
      { cookieName: 'echosupport_session' },
    );
    const context = {
      userId: 'user-1',
      email: 'owner@example.com',
      tenantId: 'tenant-1',
      membershipId: 'membership-1',
      role: 'OWNER' as const,
    };

    await expect(adapter.assertWorkspaceAccess(context, 'tenant-2')).resolves.toBeUndefined();
    await expect(adapter.assertWorkspaceAccess(context, 'tenant-3')).rejects.toMatchObject({
      code: 'WORKSPACE_ACCESS_DENIED',
    });
    await expect(adapter.assertWorkspaceAccess(context, 'tenant-4')).rejects.toMatchObject({
      code: 'WORKSPACE_ACCESS_DENIED',
    });
  });
});
