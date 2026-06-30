/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({
  prisma: {
    visitorRateLimit: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../db/prisma.js';
import { checkMessageLimit, checkSessionLimit } from '../services/visitor-rate-limit.js';

const now = new Date('2026-06-29T12:00:00.000Z');

function record(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'agent-1',
    visitorKey: 'visitor-1',
    messagesHour: 0,
    sessionsToday: 0,
    blockedUntil: null,
    lastResetAt: new Date(now.getTime() - 1000),
    ...overrides,
  };
}

describe('visitor rate limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(prisma.visitorRateLimit.update).mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('rejects an actively blocked visitor without updating counters', async () => {
    const blockedUntil = new Date(now.getTime() + 60_000);
    vi.mocked(prisma.visitorRateLimit.findUnique).mockResolvedValueOnce(
      record({ blockedUntil }) as never,
    );

    await expect(checkMessageLimit('agent-1', 'visitor-1', 10)).resolves.toEqual({
      allowed: false,
      reason: 'blocked',
      retryAfter: blockedUntil,
    });
    expect(prisma.visitorRateLimit.update).not.toHaveBeenCalled();
  });

  it('resets an expired hourly counter', async () => {
    vi.mocked(prisma.visitorRateLimit.findUnique).mockResolvedValueOnce(
      record({
        messagesHour: 99,
        lastResetAt: new Date(now.getTime() - 60 * 60 * 1000 - 1),
      }) as never,
    );

    await expect(checkMessageLimit('agent-1', 'visitor-1', 10)).resolves.toEqual({
      allowed: true,
    });
    expect(prisma.visitorRateLimit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ messagesHour: 1, lastResetAt: now }),
      }),
    );
  });

  it('blocks when the message or session limit is exceeded', async () => {
    vi.mocked(prisma.visitorRateLimit.findUnique)
      .mockResolvedValueOnce(record({ messagesHour: 10 }) as never)
      .mockResolvedValueOnce(record({ sessionsToday: 2 }) as never);

    await expect(checkMessageLimit('agent-1', 'visitor-1', 10)).resolves.toMatchObject({
      allowed: false,
      reason: 'messages_exceeded',
    });
    await expect(checkSessionLimit('agent-1', 'visitor-1', 2)).resolves.toMatchObject({
      allowed: false,
      reason: 'sessions_exceeded',
    });
  });

  it('creates a counter for a new visitor', async () => {
    vi.mocked(prisma.visitorRateLimit.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.visitorRateLimit.create).mockResolvedValueOnce(record() as never);

    await expect(checkSessionLimit('agent-1', 'new-visitor', 5)).resolves.toEqual({
      allowed: true,
    });
    expect(prisma.visitorRateLimit.create).toHaveBeenCalledOnce();
  });
});
