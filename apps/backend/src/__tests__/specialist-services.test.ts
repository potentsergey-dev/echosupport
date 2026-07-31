import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({ prisma: {} }));
import { filterServicesForSpecialist } from '../services/specialist-services.js';

const services = [
  { id: 'color', name: 'Dimensional color', specialistId: null },
  { id: 'face', name: 'Face practice', specialistId: null },
  { id: 'cut', name: 'Signature cut', specialistId: null },
  { id: 'skin', name: 'Skin ritual', specialistId: null },
];

describe('specialist service compatibility mapping', () => {
  it('returns only services named in the specialist description', () => {
    expect(
      filterServicesForSpecialist(
        { id: 'eva', description: 'Эстетист. Услуги: Skin ritual, Face practice.' },
        services,
      ).map(({ id }) => id),
    ).toEqual(['face', 'skin']);
  });

  it('matches service names case-insensitively across punctuation', () => {
    expect(
      filterServicesForSpecialist(
        { id: 'anna', description: 'SIGNATURE CUT / dimensional COLOR' },
        services,
      ).map(({ id }) => id),
    ).toEqual(['color', 'cut']);
  });

  it('keeps directly assigned services in addition to described services', () => {
    const assigned = [
      ...services,
      { id: 'consultation', name: 'Consultation', specialistId: 'eva' },
    ];
    expect(
      filterServicesForSpecialist({ id: 'eva', description: 'Face practice' }, assigned).map(
        ({ id }) => id,
      ),
    ).toEqual(['face', 'consultation']);
  });

  it('preserves legacy global-service behavior when no mapping is described', () => {
    expect(filterServicesForSpecialist({ id: 'eva', description: 'Эстетист' }, services)).toEqual(
      services,
    );
  });
});
