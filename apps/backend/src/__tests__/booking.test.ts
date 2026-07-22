/* eslint-disable @typescript-eslint/unbound-method */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({
  prisma: {
    service: { findFirst: vi.fn() },
    appointment: { findMany: vi.fn() },
  },
}));

import { prisma } from '../db/prisma.js';
import {
  assertSlotCanAcceptAppointment,
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
      isGroup: true,
      capacity: 5,
    } as never);

    await expect(
      getBookableServiceForSpecialist({
        tenantId: 'tenant-1',
        specialistId: 'specialist-1',
        serviceId: 'service-1',
      }),
    ).resolves.toEqual({ id: 'service-1', durationMin: 45, isGroup: true, capacity: 5 });

    expect(prisma.service.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'service-1',
        tenantId: 'tenant-1',
        isActive: true,
        OR: [{ specialistId: null }, { specialistId: 'specialist-1' }],
      },
      select: { id: true, durationMin: true, isGroup: true, capacity: true },
    });
  });

  it('uses default duration when no service is selected', async () => {
    await expect(
      getBookableServiceForSpecialist({
        tenantId: 'tenant-1',
        specialistId: 'specialist-1',
      }),
    ).resolves.toEqual({ id: null, durationMin: 60, isGroup: false, capacity: 1 });

    expect(prisma.service.findFirst).not.toHaveBeenCalled();
  });

  it('allows group appointments until the configured capacity is reached', async () => {
    const startsAt = new Date('2026-06-29T09:00:00');
    const endsAt = new Date('2026-06-29T10:00:00');

    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      { id: 'appt-1', serviceId: 'service-1', startsAt, endsAt },
    ] as never);

    await expect(
      assertSlotCanAcceptAppointment({
        specialistId: 'specialist-1',
        serviceId: 'service-1',
        startsAt,
        endsAt,
        isGroup: true,
        capacity: 2,
      }),
    ).resolves.toBeUndefined();

    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      { id: 'appt-1', serviceId: 'service-1', startsAt, endsAt },
      { id: 'appt-2', serviceId: 'service-1', startsAt, endsAt },
    ] as never);

    await expect(
      assertSlotCanAcceptAppointment({
        specialistId: 'specialist-1',
        serviceId: 'service-1',
        startsAt,
        endsAt,
        isGroup: true,
        capacity: 2,
      }),
    ).rejects.toThrow('SLOT_FULL');
  });

  it('blocks overlapping appointments for non-group services and different group slots', async () => {
    const startsAt = new Date('2026-06-29T09:00:00');
    const endsAt = new Date('2026-06-29T10:00:00');

    vi.mocked(prisma.appointment.findMany).mockResolvedValueOnce([
      { id: 'appt-1', serviceId: 'service-2', startsAt, endsAt },
    ] as never);

    await expect(
      assertSlotCanAcceptAppointment({
        specialistId: 'specialist-1',
        serviceId: 'service-1',
        startsAt,
        endsAt,
        isGroup: true,
        capacity: 5,
      }),
    ).rejects.toThrow('SLOT_TAKEN');
  });
});
