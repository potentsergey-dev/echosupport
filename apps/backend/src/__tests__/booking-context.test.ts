import { describe, expect, it } from 'vitest';
import {
  buildBookingDateQuestion,
  deriveBookingContext,
  hasExplicitBookingDateTime,
  hasExplicitDateReference,
} from '../services/booking-context.js';

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
      selectedSlot: true,
      selectedSlotTime: '10:00',
    });
  });

  it('preserves a selected slot while the visitor supplies contact details', () => {
    const pending = {
      serviceId: 'face-practice',
      serviceName: 'Face practice',
      needsDate: true,
    };
    const selected = deriveBookingContext(pending, '7 августа 09:00', services);

    expect(selected).toEqual({
      ...pending,
      needsDate: false,
      selectedSlot: true,
      selectedSlotTime: '09:00',
    });
    expect(deriveBookingContext(selected, 'Сергей +375290000004', services)).toEqual(selected);
    expect(deriveBookingContext(selected, '8 августа', services)).toEqual({
      ...pending,
      needsDate: false,
    });
  });
  it('requires both date and time before a slot can be selected', () => {
    expect(hasExplicitBookingDateTime('7 августа в 10:00')).toBe(true);
    expect(hasExplicitBookingDateTime('7 августа')).toBe(false);
    expect(hasExplicitBookingDateTime('1 человек')).toBe(false);
  });

  it('builds a direct date question in the visitor language', () => {
    expect(buildBookingDateQuestion('Face practice', 'Хочу Face practice')).toContain(
      'укажите, пожалуйста, дату',
    );
    expect(buildBookingDateQuestion('Face practice', 'I want Face practice')).toContain(
      'which date',
    );
  });
  it('recognizes relative and explicit Russian dates', () => {
    expect(hasExplicitDateReference('На завтра')).toBe(true);
    expect(hasExplicitDateReference('7 авг')).toBe(true);
    expect(hasExplicitDateReference('Хочу только себя')).toBe(false);
  });
});
