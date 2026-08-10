import { describe, expect, it } from 'vitest';
import {
  buildBookingDateQuestion,
  buildBookingStateContext,
  deriveBookingContext,
  hasExplicitBookingDateTime,
  hasExplicitDateReference,
} from '../services/booking-context.js';

const services = [
  { id: 'dimensional', name: 'Dimensional color' },
  { id: 'face-practice', name: 'Face practice' },
  { id: 'signature-cut', name: 'Signature cut' },
];

const specialists = [
  { id: 'anna', name: 'Анна Левина' },
  { id: 'eva', name: 'Ева Король' },
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
      availabilitySearchRequested: true,
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
      availabilitySearchRequested: true,
    });
    expect(deriveBookingContext(selected, 'Сергей +375290000004', services)).toEqual({
      ...pending,
      needsDate: false,
      selectedSlot: true,
      selectedSlotTime: '09:00',
    });
    expect(deriveBookingContext(selected, '8 августа', services)).toEqual({
      ...pending,
      needsDate: false,
      availabilitySearchRequested: true,
    });
  });
  it('remembers a confirmed single participant while collecting booking details', () => {
    const selected = {
      serviceId: 'face-practice',
      serviceName: 'Face practice',
      needsDate: false,
      selectedSlot: true as const,
      selectedSlotTime: '09:00',
    };

    const confirmed = deriveBookingContext(selected, 'Только для себя', services);

    expect(confirmed).toEqual({ ...selected, groupParticipants: 1 });
    expect(deriveBookingContext(confirmed, 'Сергей +375290000004', services)).toEqual(confirmed);
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
  it('recognizes relative, textual, and numeric Russian dates', () => {
    expect(hasExplicitDateReference('На завтра')).toBe(true);
    expect(hasExplicitDateReference('На этой неделе')).toBe(true);
    expect(hasExplicitDateReference('next week')).toBe(true);
    expect(hasExplicitDateReference('7 авг')).toBe(true);
    expect(hasExplicitDateReference('07.08')).toBe(true);
    expect(hasExplicitDateReference('07.08.2026')).toBe(true);
    expect(hasExplicitDateReference('Хочу только себя')).toBe(false);
  });

  it('keeps the conversation language for a numeric date clarification', () => {
    expect(
      buildBookingDateQuestion('Face practice', '07.08', 'Для записи укажите дату.'),
    ).toContain('укажите, пожалуйста, дату');
  });

  it('keeps the selected specialist and service while the visitor asks for other dates', () => {
    const initial = deriveBookingContext(
      null,
      'Найди свободное время у Анны на Signature cut на этой неделе.',
      services,
      specialists,
    );

    expect(initial).toEqual({
      serviceId: 'signature-cut',
      serviceName: 'Signature cut',
      specialistId: 'anna',
      specialistName: 'Анна Левина',
      needsDate: false,
      availabilitySearchRequested: true,
    });

    expect(deriveBookingContext(initial, 'А какие есть даты?', services, specialists)).toEqual({
      serviceId: 'signature-cut',
      serviceName: 'Signature cut',
      specialistId: 'anna',
      specialistName: 'Анна Левина',
      needsDate: false,
      alternativeDatesRequested: true,
    });
  });

  it('does not carry a service to a newly selected specialist without a service', () => {
    const initial = {
      serviceId: 'signature-cut',
      serviceName: 'Signature cut',
      specialistId: 'anna',
      specialistName: 'Анна Левина',
      needsDate: false,
    };

    expect(deriveBookingContext(initial, 'А к Еве?', services, specialists)).toBeNull();
  });

  it('builds an authoritative next-step instruction for alternative dates', () => {
    expect(
      buildBookingStateContext({
        serviceId: 'signature-cut',
        serviceName: 'Signature cut',
        specialistId: 'anna',
        specialistName: 'Анна Левина',
        needsDate: false,
        alternativeDatesRequested: true,
      }),
    ).toContain('search_next_available=true');
  });

  it('requires an immediate slot lookup after the visitor gives a date', () => {
    expect(
      buildBookingStateContext({
        serviceId: 'signature-cut',
        serviceName: 'Signature cut',
        specialistId: 'anna',
        specialistName: 'Анна Левина',
        needsDate: false,
        availabilitySearchRequested: true,
      }),
    ).toContain('Do not ask the visitor to confirm the service first.');
  });
});
