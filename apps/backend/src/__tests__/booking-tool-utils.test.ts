import { describe, expect, it } from 'vitest';
import {
  buildSlotQuickReplies,
  matchSpecialistsByName,
  resolveRelativeBookingDateRange,
} from '../services/booking-tool-utils.js';

describe('booking tool utilities', () => {
  const now = new Date('2026-07-31T09:00:00.000Z');

  it('resolves this week as the current Monday-Sunday in business time', () => {
    expect(
      resolveRelativeBookingDateRange('Хочу записаться на этой неделе', now, 'Europe/Minsk'),
    ).toEqual({ kind: 'this_week', dateFrom: '2026-07-27', dateTo: '2026-08-02' });
  });

  it('resolves next week, today, and tomorrow deterministically', () => {
    expect(resolveRelativeBookingDateRange('на следующей неделе', now, 'Europe/Minsk')).toEqual({
      kind: 'next_week',
      dateFrom: '2026-08-03',
      dateTo: '2026-08-09',
    });
    expect(resolveRelativeBookingDateRange('сегодня', now, 'Europe/Minsk')).toEqual({
      kind: 'today',
      dateFrom: '2026-07-31',
      dateTo: '2026-07-31',
    });
    expect(resolveRelativeBookingDateRange('завтра', now, 'Europe/Minsk')).toEqual({
      kind: 'tomorrow',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-01',
    });
  });

  it('matches inflected and partial Russian specialist names', () => {
    const specialists = [
      { id: 'eva', name: 'Ева Король', matchingHints: ['Ева', 'Еве', 'Еву', 'Король'] },
      { id: 'anna', name: 'Анна Левина', matchingHints: ['Анна', 'Анне', 'Левина'] },
    ];
    expect(matchSpecialistsByName('Еве', specialists).map(({ id }) => id)).toEqual(['eva']);
    expect(matchSpecialistsByName('к Анне', specialists).map(({ id }) => id)).toEqual(['anna']);
  });

  it('keeps all equally good specialist matches for clarification', () => {
    const specialists = [
      { id: 'eva-1', name: 'Ева Король', matchingHints: ['Ева', 'Еве'] },
      { id: 'eva-2', name: 'Ева Миронова', matchingHints: ['Ева', 'Еве'] },
    ];
    expect(matchSpecialistsByName('Еве', specialists).map(({ id }) => id)).toEqual([
      'eva-1',
      'eva-2',
    ]);
  });

  it('builds quick replies from the first three slots', () => {
    expect(
      buildSlotQuickReplies([
        { localDate: '2026-08-01', localStartTime: '10:30' },
        { localDate: '2026-08-01', localStartTime: '12:00' },
        { localDate: '2026-08-02', localStartTime: '11:00' },
        { localDate: '2026-08-02', localStartTime: '12:00' },
      ]),
    ).toEqual(['1 авг 10:30', '1 авг 12:00', '2 авг 11:00', 'Другой день']);
  });
});
