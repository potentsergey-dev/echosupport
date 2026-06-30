/* eslint-disable @typescript-eslint/unbound-method */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({
  prisma: {
    specialist: { findUnique: vi.fn() },
    service: { findUnique: vi.fn() },
    appointment: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

import { prisma } from '../db/prisma.js';
import {
  findAvailableSlots,
  isSlotAvailable,
  isSlotWithinWorkingHours,
} from '../services/slot-finder.js';

describe('slot finder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty slots for an inactive or missing specialist', async () => {
    vi.mocked(prisma.specialist.findUnique).mockResolvedValueOnce(null);
    await expect(
      findAvailableSlots('specialist-1', null, '2026-06-29T00:00:00', '2026-06-29T18:00:00'),
    ).resolves.toEqual([]);
  });

  it('excludes overlapping appointments and keeps boundary-adjacent slots', async () => {
    vi.mocked(prisma.specialist.findUnique).mockResolvedValue({
      isActive: true,
      workingHours: [{ dayOfWeek: 1, fromMinutes: 9 * 60, toMinutes: 12 * 60 }],
    } as never);
    vi.mocked(prisma.service.findUnique).mockResolvedValue({ durationMin: 60 } as never);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      {
        startsAt: new Date('2026-06-29T10:00:00'),
        endsAt: new Date('2026-06-29T11:00:00'),
      },
    ] as never);

    const slots = await findAvailableSlots(
      'specialist-1',
      'service-1',
      new Date('2026-06-29T09:00:00'),
      new Date('2026-06-29T12:00:00'),
    );

    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => new Date(slot.startsAt).getHours())).toEqual([9, 11]);
  });

  it('checks conflicts and working-hour boundaries', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);
    await expect(
      isSlotAvailable(
        'specialist-1',
        new Date('2026-06-29T09:00:00'),
        new Date('2026-06-29T10:00:00'),
      ),
    ).resolves.toBe(true);

    vi.mocked(prisma.specialist.findUnique).mockResolvedValueOnce({
      isActive: true,
      workingHours: [{ dayOfWeek: 1, fromMinutes: 540, toMinutes: 600 }],
    } as never);
    await expect(
      isSlotWithinWorkingHours(
        'specialist-1',
        new Date('2026-06-29T09:00:00'),
        new Date('2026-06-29T10:00:00'),
      ),
    ).resolves.toBe(true);
  });
});
