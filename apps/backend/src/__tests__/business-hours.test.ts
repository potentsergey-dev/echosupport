/* eslint-disable @typescript-eslint/unbound-method */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({
  prisma: {
    businessHours: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../db/prisma.js';
import { getOutOfHoursMessage, isBusinessHoursNow } from '../services/business-hours.js';

describe('business hours', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T09:30:00.000Z')); // Monday, 12:30 in Minsk
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('allows access when business hours are not configured or disabled', async () => {
    vi.mocked(prisma.businessHours.findUnique).mockResolvedValueOnce(null);
    await expect(isBusinessHoursNow('agent-1')).resolves.toBe(true);

    vi.mocked(prisma.businessHours.findUnique).mockResolvedValueOnce({
      enabled: false,
    } as never);
    await expect(isBusinessHoursNow('agent-1')).resolves.toBe(true);
  });

  it('checks schedule in the configured timezone', async () => {
    vi.mocked(prisma.businessHours.findUnique).mockResolvedValue({
      enabled: true,
      timezone: 'Europe/Minsk',
      holidays: [],
      schedule: [{ dayOfWeek: 1, from: '12:00', to: '13:00' }],
    } as never);

    await expect(isBusinessHoursNow('agent-1')).resolves.toBe(true);
  });

  it('treats a configured holiday and the end boundary as closed', async () => {
    vi.mocked(prisma.businessHours.findUnique).mockResolvedValueOnce({
      enabled: true,
      timezone: 'Europe/Minsk',
      holidays: ['2026-06-29'],
      schedule: [{ dayOfWeek: 1, from: '09:00', to: '18:00' }],
    } as never);
    await expect(isBusinessHoursNow('agent-1')).resolves.toBe(false);

    vi.setSystemTime(new Date('2026-06-29T10:00:00.000Z')); // 13:00 in Minsk
    vi.mocked(prisma.businessHours.findUnique).mockResolvedValueOnce({
      enabled: true,
      timezone: 'Europe/Minsk',
      holidays: [],
      schedule: [{ dayOfWeek: 1, from: '12:00', to: '13:00' }],
    } as never);
    await expect(isBusinessHoursNow('agent-1')).resolves.toBe(false);
  });

  it('returns only an enabled out-of-hours message', async () => {
    vi.mocked(prisma.businessHours.findUnique).mockResolvedValueOnce({
      enabled: true,
      outOfHoursMessage: 'Back tomorrow',
    } as never);
    await expect(getOutOfHoursMessage('agent-1')).resolves.toBe('Back tomorrow');
  });
});
