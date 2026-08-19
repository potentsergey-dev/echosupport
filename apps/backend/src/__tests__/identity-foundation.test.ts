import { describe, expect, it } from 'vitest';
import {
  assertMembershipChangeAllowed,
  constantTimeEqual,
  createCsrfToken,
  createOpaqueToken,
  hashOpaqueToken,
  normalizeEmail,
  resolveCurrentPlan,
  resolveWorkspaceSessionContext,
  sanitizeAuditMetadata,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  verifyCsrfToken,
} from '../services/identity-foundation.js';

describe('Phase 2 identity foundation', () => {
  it('normalizes emails for provider-neutral identity matching', () => {
    expect(normalizeEmail('  Owner@Example.COM ')).toBe('owner@example.com');
  });

  it('creates high-entropy opaque tokens and stores only stable hashes', () => {
    const token = createOpaqueToken();
    const otherToken = createOpaqueToken();

    expect(token).not.toBe(otherToken);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    expect(hashOpaqueToken(token)).not.toBe(token);
    expect(hashOpaqueToken(token)).not.toBe(hashOpaqueToken(otherToken));
  });

  it('rejects weak opaque token sizes', () => {
    expect(() => createOpaqueToken(16)).toThrow('at least 32 random bytes');
  });

  it('compares same-length secrets in constant-time code paths', () => {
    expect(constantTimeEqual('same-secret', 'same-secret')).toBe(true);
    expect(constantTimeEqual('same-secret', 'diff-secret')).toBe(false);
    expect(constantTimeEqual('short', 'a-longer-secret')).toBe(false);
  });

  it('binds CSRF tokens to the session token hash and secret', () => {
    const sessionHash = hashOpaqueToken(createOpaqueToken());
    const csrfSecret = createOpaqueToken();
    const token = createCsrfToken(sessionHash, csrfSecret);

    expect(verifyCsrfToken(token, sessionHash, csrfSecret)).toBe(true);
    expect(verifyCsrfToken(token, sessionHash, createOpaqueToken())).toBe(false);
    expect(verifyCsrfToken(undefined, sessionHash, csrfSecret)).toBe(false);
  });

  it('serializes production session cookies with HttpOnly and Secure flags', () => {
    const cookie = serializeSessionCookie('opaque', {
      name: '__Host-echosupport_session',
      secure: true,
      sameSite: 'lax',
      maxAgeSeconds: 3600,
    });

    expect(cookie).toContain('__Host-echosupport_session=opaque');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Domain=');
  });

  it('requires Secure for __Host- session cookies', () => {
    expect(() =>
      serializeSessionCookie('opaque', {
        name: '__Host-echosupport_session',
        secure: false,
        sameSite: 'lax',
        maxAgeSeconds: 3600,
      }),
    ).toThrow('__Host- session cookies must be Secure');
  });

  it('clears session cookies with matching safe attributes', () => {
    const cookie = serializeExpiredSessionCookie({
      name: 'echosupport_session',
      secure: false,
      sameSite: 'strict',
    });

    expect(cookie).toContain('echosupport_session=');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('uses hashes for invitation tokens and never needs raw tokens at rest', () => {
    const raw = createOpaqueToken();
    const storedHash = hashOpaqueToken(raw);

    expect(storedHash).not.toBe(raw);
    expect(hashOpaqueToken(raw)).toBe(storedHash);
    expect(hashOpaqueToken(createOpaqueToken())).not.toBe(storedHash);
  });

  it('resolves workspace context only through an active matching membership', () => {
    const membership = {
      id: 'membership-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'ADMIN' as const,
      status: 'ACTIVE' as const,
    };

    expect(resolveWorkspaceSessionContext('user-1', 'tenant-1', membership)).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      membershipId: 'membership-1',
      role: 'ADMIN',
    });
    expect(() => resolveWorkspaceSessionContext('user-2', 'tenant-1', membership)).toThrow(
      'Workspace access denied',
    );
    expect(() =>
      resolveWorkspaceSessionContext('user-1', 'tenant-2', {
        ...membership,
        tenantId: 'tenant-2',
        status: 'SUSPENDED',
      }),
    ).toThrow('Workspace access denied');
  });

  it('protects the last active owner from demotion, suspension or removal', () => {
    expect(() =>
      assertMembershipChangeAllowed({
        activeOwnerCount: 1,
        currentRole: 'OWNER',
        currentStatus: 'ACTIVE',
        nextRole: 'ADMIN',
      }),
    ).toThrow('last active OWNER');
    expect(() =>
      assertMembershipChangeAllowed({
        activeOwnerCount: 1,
        currentRole: 'OWNER',
        currentStatus: 'ACTIVE',
        nextStatus: 'REMOVED',
      }),
    ).toThrow('last active OWNER');
    expect(() =>
      assertMembershipChangeAllowed({
        activeOwnerCount: 2,
        currentRole: 'OWNER',
        currentStatus: 'ACTIVE',
        nextRole: 'ADMIN',
      }),
    ).not.toThrow();
  });

  it('resolves current durable plan assignment by validity period', () => {
    const at = new Date('2026-08-19T12:00:00.000Z');

    expect(
      resolveCurrentPlan(
        [
          {
            tenantId: 'tenant-1',
            plan: 'Lite',
            startsAt: new Date('2026-08-01T00:00:00.000Z'),
            endsAt: new Date('2026-08-10T00:00:00.000Z'),
          },
          {
            tenantId: 'tenant-1',
            plan: 'PRO',
            startsAt: new Date('2026-08-10T00:00:00.000Z'),
            endsAt: null,
          },
        ],
        at,
      ),
    ).toBe('PRO');
  });

  it('sanitizes audit metadata recursively', () => {
    expect(
      sanitizeAuditMetadata({
        action: 'login',
        token: 'raw-token',
        nested: {
          csrfSecret: 'secret',
          safe: 'kept',
        },
        list: [{ password: 'secret' }, { targetId: 'agent-1' }],
      }),
    ).toEqual({
      action: 'login',
      nested: { safe: 'kept' },
      list: [{}, { targetId: 'agent-1' }],
    });
  });
});
