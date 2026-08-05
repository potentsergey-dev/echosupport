import { describe, expect, it } from 'vitest';
import { deriveBookingContext, hasExplicitDateReference } from '../services/booking-context.js';

const services = [
  { id: 'dimensional', name: 'Dimensional color' },
  { id: 'face-practice', name: 'Face practice' },
];

describe('booking context', () => {
  it('requires a new date when a visitor switches services without one', () => {
    const first = deriveBookingContext(null, 'На завтра есть Dimensional color?', services);
    const switched = deriveBookingContext(
      first,
      'Хочу записаться к Еве на Face practice',
      services,
    );

    expect(switched).toEqual({
      serviceId: 'face-practice',
      serviceName: 'Face practice',
      needsDate: true,
    });
  });

  it('keeps the requirement through contact collection and clears it after a date', () => {
    const pending = {
      serviceId: 'face-practice',
      serviceName: 'Face practice',
      needsDate: true,
    };

    expect(deriveBookingContext(pending, 'Сергей +375290000004', services)).toEqual(pending);
    expect(deriveBookingContext(pending, '7 августа в 10:00', services)).toEqual({
      ...pending,
      needsDate: false,
    });
  });

  it('recognizes relative and explicit Russian dates', () => {
    expect(hasExplicitDateReference('На завтра')).toBe(true);
    expect(hasExplicitDateReference('7 авг')).toBe(true);
    expect(hasExplicitDateReference('Хочу только себя')).toBe(false);
  });
});
