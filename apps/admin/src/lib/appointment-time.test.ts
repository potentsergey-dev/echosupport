import { afterEach, expect, it, vi } from 'vitest';
import { appointmentLocalValue, appointmentLocalToIso } from './appointment-time';
afterEach(() => vi.unstubAllEnvs());
it('does not shift a rescheduled appointment by the browser UTC offset', () => {
  vi.stubEnv('TZ', 'Europe/Minsk');
  const original = '2099-12-01T09:00:00.000Z';
  expect(appointmentLocalValue(original)).toBe('2099-12-01T12:00');
  expect(appointmentLocalToIso(appointmentLocalValue(original), original)).toBe(original);
  expect(appointmentLocalToIso('2099-12-02T12:00')).toBe('2099-12-02T09:00:00.000Z');
});
it('rejects DST gaps and ambiguous new local times', () => {
  vi.stubEnv('TZ', 'America/New_York');
  expect(() => appointmentLocalToIso('2026-03-08T02:30')).toThrow();
  expect(() => appointmentLocalToIso('2026-11-01T01:30')).toThrow();
});
it('preserves an unchanged appointment even in the second occurrence of a DST fold', () => {
  vi.stubEnv('TZ', 'America/New_York');
  const original = '2026-11-01T06:30:00.000Z';
  expect(appointmentLocalValue(original)).toBe('2026-11-01T01:30');
  expect(appointmentLocalToIso('2026-11-01T01:30', original)).toBe(original);
});
