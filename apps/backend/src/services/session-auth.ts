import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { AuthWorkspaceAdapter, WorkspaceAuthContext } from '../contracts/infrastructure.js';
import { ApiError } from './api-errors.js';
import { hashOpaqueToken, resolveWorkspaceSessionContext } from './identity-foundation.js';

export interface SessionAuthAdapterOptions {
  cookieName: string;
  idleTtlMs?: number;
  lastSeenAtThrottleMs?: number;
  now?: () => Date;
}

function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const [name, ...rawValue] = part.trim().split('=');
    if (!name || rawValue.length === 0) continue;
    cookies.set(name, rawValue.join('='));
  }
  return cookies;
}

function cookieValue(request: FastifyRequest, name: string): string | null {
  return parseCookieHeader(request.headers.cookie).get(name) ?? null;
}

export class PrismaSessionAuthWorkspaceAdapter implements AuthWorkspaceAdapter {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: SessionAuthAdapterOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async authenticateRequest(request: FastifyRequest): Promise<WorkspaceAuthContext> {
    const token = cookieValue(request, this.options.cookieName);
    if (!token) throw new Error('Missing session cookie');

    const tokenHash = hashOpaqueToken(token);
    const now = this.now();
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            status: true,
          },
        },
        selectedMembership: {
          select: {
            id: true,
            userId: true,
            tenantId: true,
            role: true,
            status: true,
          },
        },
      },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.status !== 'ACTIVE' ||
      !session.tenantId ||
      !session.selectedMembership
    ) {
      throw new Error('Invalid session');
    }

    if (
      this.options.idleTtlMs &&
      session.lastSeenAt.getTime() + this.options.idleTtlMs <= now.getTime()
    ) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: now },
      });
      throw new Error('Session idle timeout');
    }

    const context = resolveWorkspaceSessionContext(
      session.userId,
      session.tenantId,
      session.selectedMembership,
    );

    const shouldTouchLastSeen =
      !this.options.lastSeenAtThrottleMs ||
      session.lastSeenAt.getTime() + this.options.lastSeenAtThrottleMs <= now.getTime();
    if (shouldTouchLastSeen) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
    }

    return {
      ...context,
      email: session.user.email,
    };
  }

  async assertWorkspaceAccess(context: WorkspaceAuthContext, workspaceId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: context.userId, tenantId: workspaceId } },
      select: { id: true, status: true },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      throw new ApiError('WORKSPACE_ACCESS_DENIED', { tenantId: workspaceId });
    }
  }
}
