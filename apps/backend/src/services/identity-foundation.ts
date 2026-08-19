import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import type { PlanName } from '../contracts/entitlements.js';

const SENSITIVE_METADATA_KEYS = new Set([
  'authorization',
  'cookie',
  'csrf',
  'csrftoken',
  'csrfsecret',
  'idtoken',
  'token',
  'session',
  'sessioncookie',
  'sessiontoken',
  'password',
  'passwordhash',
  'resettoken',
  'invitationtoken',
  'providersecret',
]);

export type MembershipRole = Extract<UserRole, 'OWNER' | 'ADMIN' | 'OPERATOR'>;
export type MembershipStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REMOVED';
export type TenantPlan = Extract<PlanName, 'Lite' | 'PRO'>;
export type TenantPlanAssignmentSource = 'ONBOARDING' | 'MANUAL' | 'COMPATIBILITY_BACKFILL';

export interface SessionCookieOptions {
  name: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  maxAgeSeconds: number;
}

export interface MembershipSnapshot {
  id: string;
  userId: string;
  tenantId: string;
  role: MembershipRole;
  status: MembershipStatus;
}

export interface WorkspaceSessionContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: MembershipRole;
}

export interface PlanAssignmentSnapshot {
  tenantId: string;
  plan: TenantPlan;
  startsAt: Date;
  endsAt: Date | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createOpaqueToken(byteLength = 32): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 32) {
    throw new Error('Opaque tokens must contain at least 32 random bytes.');
  }
  return randomBytes(byteLength).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

export function createRotatedSessionToken(): { token: string; tokenHash: string } {
  const token = createOpaqueToken();
  return { token, tokenHash: hashOpaqueToken(token) };
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createCsrfToken(sessionTokenHash: string, csrfSecret: string): string {
  return hashOpaqueToken(`${sessionTokenHash}.${csrfSecret}`);
}

export function verifyCsrfToken(
  candidate: string | undefined,
  sessionTokenHash: string,
  csrfSecret: string,
): boolean {
  if (!candidate) return false;
  return constantTimeEqual(candidate, createCsrfToken(sessionTokenHash, csrfSecret));
}

export function serializeSessionCookie(token: string, options: SessionCookieOptions): string {
  const attributes = [
    `${options.name}=${token}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${options.maxAgeSeconds}`,
    `SameSite=${options.sameSite === 'none' ? 'None' : options.sameSite === 'strict' ? 'Strict' : 'Lax'}`,
  ];
  if (options.secure) attributes.push('Secure');
  if (options.name.startsWith('__Host-') && !options.secure) {
    throw new Error('__Host- session cookies must be Secure.');
  }
  return attributes.join('; ');
}

export function serializeExpiredSessionCookie(
  options: Omit<SessionCookieOptions, 'maxAgeSeconds'>,
): string {
  return serializeSessionCookie('', { ...options, maxAgeSeconds: 0 });
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !SENSITIVE_METADATA_KEYS.has(key.toLowerCase()))
      .map(([key, value]) => [key, sanitizeAuditValue(value)]),
  );
}

function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (!value || typeof value !== 'object') return value;
  return sanitizeAuditMetadata(value as Record<string, unknown>);
}

export function resolveWorkspaceSessionContext(
  userId: string,
  selectedTenantId: string,
  membership: MembershipSnapshot | null,
): WorkspaceSessionContext {
  if (
    !membership ||
    membership.userId !== userId ||
    membership.tenantId !== selectedTenantId ||
    membership.status !== 'ACTIVE'
  ) {
    throw new Error('Workspace access denied');
  }
  return {
    userId,
    tenantId: selectedTenantId,
    membershipId: membership.id,
    role: membership.role,
  };
}

export function assertMembershipChangeAllowed(options: {
  activeOwnerCount: number;
  currentRole: MembershipRole;
  currentStatus: MembershipStatus;
  nextRole?: MembershipRole | undefined;
  nextStatus?: MembershipStatus | undefined;
}): void {
  const nextRole = options.nextRole ?? options.currentRole;
  const nextStatus = options.nextStatus ?? options.currentStatus;
  const removesOwner =
    options.currentRole === 'OWNER' && (nextRole !== 'OWNER' || nextStatus !== 'ACTIVE');

  if (removesOwner && options.activeOwnerCount <= 1) {
    throw new Error('Cannot remove, suspend or demote the last active OWNER.');
  }
}

export function resolveCurrentPlan(
  assignments: PlanAssignmentSnapshot[],
  at = new Date(),
): TenantPlan | null {
  const active = assignments
    .filter((assignment) => assignment.startsAt <= at)
    .filter((assignment) => !assignment.endsAt || assignment.endsAt > at)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  return active[0]?.plan ?? null;
}
