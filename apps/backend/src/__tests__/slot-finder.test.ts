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
  formatAvailableSlotForBusinessTime,
  findAvailableSlots,
  isSlotAvailable,
  isSlotWithinWorkingHours,
  parseBusinessDateTime,
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
        startsAt: new Date('2026-06-29T07:00:00.000Z'),
        endsAt: new Date('2026-06-29T08:00:00.000Z'),
      },
    ] as never);

    const slots = await findAvailableSlots('specialist-1', 'service-1', '2026-06-29', '2026-06-29');

    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => slot.startsAt)).toEqual([
      '2026-06-29T06:00:00.000Z',
      '2026-06-29T08:00:00.000Z',
    ]);
  });

  it('keeps group slots available until capacity is reached', async () => {
    vi.mocked(prisma.specialist.findUnique).mockResolvedValue({
      isActive: true,
      workingHours: [{ dayOfWeek: 1, fromMinutes: 9 * 60, toMinutes: 11 * 60 }],
    } as never);
    vi.mocked(prisma.service.findUnique).mockResolvedValue({
      durationMin: 60,
      isGroup: true,
      capacity: 2,
    } as never);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      {
        serviceId: 'service-1',
        startsAt: new Date('2026-06-29T06:00:00.000Z'),
        endsAt: new Date('2026-06-29T07:00:00.000Z'),
      },
      {
        serviceId: 'service-1',
        startsAt: new Date('2026-06-29T07:00:00.000Z'),
        endsAt: new Date('2026-06-29T08:00:00.000Z'),
      },
      {
        serviceId: 'service-1',
        startsAt: new Date('2026-06-29T07:00:00.000Z'),
        endsAt: new Date('2026-06-29T08:00:00.000Z'),
      },
    ] as never);

    const slots = await findAvailableSlots('specialist-1', 'service-1', '2026-06-29', '2026-06-29');

    expect(slots).toHaveLength(1);
    expect(slots[0]!.startsAt).toBe('2026-06-29T06:00:00.000Z');
  });

  it('generates available slots in the business timezone instead of server UTC', async () => {
    vi.mocked(prisma.specialist.findUnique).mockResolvedValue({
      isActive: true,
      workingHours: [{ dayOfWeek: 4, fromMinutes: 9 * 60, toMinutes: 18 * 60 }],
    } as never);
    vi.mocked(prisma.service.findUnique).mockResolvedValue({ durationMin: 90 } as never);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);

    const slots = await findAvailableSlots('specialist-1', 'service-1', '2026-08-06', '2026-08-06');

    expect(slots[0]?.startsAt).toBe('2026-08-06T06:00:00.000Z');
    expect(slots[0]?.endsAt).toBe('2026-08-06T07:30:00.000Z');
  });

  it('skips past slots today and aligns to the next service-duration slot', async () => {
    vi.mocked(prisma.specialist.findUnique).mockResolvedValue({
      isActive: true,
      workingHours: [{ dayOfWeek: 5, fromMinutes: 9 * 60, toMinutes: 18 * 60 }],
    } as never);
    vi.mocked(prisma.service.findUnique).mockResolvedValue({ durationMin: 90 } as never);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);

    const slots = await findAvailableSlots(
      'specialist-1',
      'service-1',
      new Date('2026-07-31T08:50:00.000Z'), // 11:50 Friday in Europe/Minsk
      '2026-07-31',
    );

    expect(slots.map((slot) => slot.startsAt)).toEqual([
      '2026-07-31T09:00:00.000Z', // 12:00 local
      '2026-07-31T10:30:00.000Z', // 13:30 local
      '2026-07-31T12:00:00.000Z', // 15:00 local
      '2026-07-31T13:30:00.000Z', // 16:30 local
    ]);
  });

  it('formats UTC slots as local business times for LLM tools', () => {
    const slot = formatAvailableSlotForBusinessTime({
      startsAt: '2026-08-04T09:00:00.000Z',
      endsAt: '2026-08-04T10:30:00.000Z',
    });

    expect(slot).toMatchObject({
      startsAtLocal: '2026-08-04 12:00',
      endsAtLocal: '2026-08-04 13:30',
      localDate: '2026-08-04',
      localStartTime: '12:00',
      localEndTime: '13:30',
      bookingValue: '2026-08-04 12:00',
      timeZone: 'Europe/Minsk',
    });
  });

  it('parses local business datetimes into UTC instants', () => {
    expect(parseBusinessDateTime('2026-08-04 12:00').toISOString()).toBe(
      '2026-08-04T09:00:00.000Z',
    );
    expect(parseBusinessDateTime('2026-08-04T12:00').toISOString()).toBe(
      '2026-08-04T09:00:00.000Z',
    );
  });

  it('checks conflicts and working-hour boundaries', async () => {
    vi.mocked(prisma.appointment.findFirst).mockResolvedValueOnce(null);
    await expect(
      isSlotAvailable(
        'specialist-1',
        new Date('2026-06-29T09:00:00.000Z'),
        new Date('2026-06-29T10:00:00.000Z'),
      ),
    ).resolves.toBe(true);

    vi.mocked(prisma.specialist.findUnique).mockResolvedValueOnce({
      isActive: true,
      workingHours: [{ dayOfWeek: 1, fromMinutes: 12 * 60, toMinutes: 13 * 60 }],
    } as never);
    await expect(
      isSlotWithinWorkingHours(
        'specialist-1',
        new Date('2026-06-29T09:00:00.000Z'),
        new Date('2026-06-29T10:00:00.000Z'),
      ),
    ).resolves.toBe(true);
  });

  it('checks working hours in the business timezone instead of server UTC', async () => {
    vi.mocked(prisma.specialist.findUnique).mockResolvedValueOnce({
      isActive: true,
      workingHours: [{ dayOfWeek: 2, fromMinutes: 9 * 60, toMinutes: 18 * 60 }],
    } as never);

    await expect(
      isSlotWithinWorkingHours(
        'specialist-1',
        new Date('2026-08-04T08:00:00.000Z'), // 11:00 Tuesday in Europe/Minsk
        new Date('2026-08-04T09:30:00.000Z'), // 12:30 Tuesday in Europe/Minsk
      ),
    ).resolves.toBe(true);
  });
});
