/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({
  prisma: {
    operatorNotification: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../services/realtime-hub.js', () => ({
  publishToOperators: vi.fn(),
}));

import { prisma } from '../db/prisma.js';
import { publishToOperators } from '../services/realtime-hub.js';
import { processNotifications } from '../services/operator-notifier.js';

describe('operator notification outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.operatorNotification.update).mockResolvedValue({} as never);
  });

  it('does not replay realtime events that were already published immediately', async () => {
    vi.mocked(prisma.operatorNotification.findMany).mockResolvedValueOnce([
      {
        id: 'notification-1',
        tenantId: 'tenant-1',
        userId: null,
        type: 'HANDOFF_REQUESTED',
        payload: { sessionId: 'session-1' },
        channels: [],
        status: 'PENDING',
        attempts: 0,
        createdAt: new Date(),
        deliveredAt: null,
      },
    ] as never);

    await processNotifications();

    expect(publishToOperators).not.toHaveBeenCalled();
    expect(prisma.operatorNotification.update).toHaveBeenCalledWith({
      where: { id: 'notification-1' },
      data: { status: 'DELIVERED', deliveredAt: expect.any(Date) },
    });
  });
});
