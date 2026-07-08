/* eslint-disable @typescript-eslint/unbound-method */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({
  prisma: {
    service: { findFirst: vi.fn() },
  },
}));

import { prisma } from '../db/prisma.js';
import {
  getBookableServiceForSpecialist,
  hasOverlappingWorkingRanges,
  timeStringSchema,
} from '../services/booking.js';

describe('booking helpers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates strict HH:mm business-hour strings', () => {
    expect(timeStringSchema.safeParse('09:30').success).toBe(true);
    expect(timeStringSchema.safeParse('24:00').success).toBe(false);
    expect(timeStringSchema.safeParse('99:99').success).toBe(false);
  });

  it('detects overlapping working ranges only within the same day', () => {
    expect(
      hasOverlappingWorkingRanges([
        { dayOfWeek: 1, fromMinutes: 9 * 60, toMinutes: 11 * 60 },
        { dayOfWeek: 1, fromMinutes: 10 * 60, toMinutes: 12 * 60 },
      ]),
    ).toBe(true);

    expect(
      hasOverlappingWorkingRanges([
        { dayOfWeek: 1, fromMinutes: 9 * 60, toMinutes: 10 * 60 },
        { dayOfWeek: 1, fromMinutes: 10 * 60, toMinutes: 11 * 60 },
        { dayOfWeek: 2, fromMinutes: 9 * 60, toMinutes: 11 * 60 },
      ]),
    ).toBe(false);
  });

  it('looks up services within the tenant and selected specialist compatibility', async () => {
    vi.mocked(prisma.service.findFirst).mockResolvedValueOnce({
      id: 'service-1',
      durationMin: 45,
    } as never);

    await expect(
      getBookableServiceForSpecialist({
        tenantId: 'tenant-1',
        specialistId: 'specialist-1',
        serviceId: 'service-1',
      }),
    ).resolves.toEqual({ id: 'service-1', durationMin: 45 });

    expect(prisma.service.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'service-1',
        tenantId: 'tenant-1',
        isActive: true,
        OR: [{ specialistId: null }, { specialistId: 'specialist-1' }],
      },
      select: { id: true, durationMin: true },
    });
  });

  it('uses default duration when no service is selected', async () => {
    await expect(
      getBookableServiceForSpecialist({
        tenantId: 'tenant-1',
        specialistId: 'specialist-1',
      }),
    ).resolves.toEqual({ id: null, durationMin: 60 });

    expect(prisma.service.findFirst).not.toHaveBeenCalled();
  });
});
