/**
 * Slot-finder service for Phase 10.6 Booking.
 *
 * Calculates available appointment slots for a specialist, taking into account:
 *   - Specialist's working hours (SpecialistWorkingHours)
 *   - Service duration (if provided)
 *   - Existing confirmed / pending appointments (not CANCELLED)
 *
 * Returns an array of ISO-string slot starts.
 */

import { prisma } from '../db/prisma.js';

export interface AvailableSlot {
  startsAt: string; // ISO string
  endsAt: string; // ISO string
}

const DEFAULT_SLOT_DURATION_MIN = 60;
export const DEFAULT_BUSINESS_TIMEZONE = 'Europe/Minsk';

interface ZonedDateTimeParts {
  dateKey: string;
  dayOfWeek: number;
  minutes: number;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export function getZonedDateTimeParts(
  date: Date,
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
): ZonedDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    dayOfWeek: dowMap[get('weekday')] ?? 0,
    minutes: parseInt(get('hour')) * 60 + parseInt(get('minute')),
  };
}

function parseDateKey(dateKey: string): LocalDateParts {
  const [year, month, day] = dateKey.split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function getTimeZoneOffsetMs(date: Date, timeZone = DEFAULT_BUSINESS_TIMEZONE): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  const asUtc = Date.UTC(
    parseInt(get('year')),
    parseInt(get('month')) - 1,
    parseInt(get('day')),
    parseInt(get('hour')),
    parseInt(get('minute')),
    parseInt(get('second')),
  );
  return asUtc - date.getTime();
}

export function zonedDateTimeToUtc(
  dateKey: string,
  minutes: number,
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
): Date {
  const { year, month, day } = parseDateKey(dateKey);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const first = new Date(localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timeZone));
  return new Date(localAsUtc - getTimeZoneOffsetMs(first, timeZone));
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function alignSlotStartToGrid(slotStart: number, dayStart: number, slotMs: number): number {
  if (slotStart <= dayStart) return dayStart;
  const offset = slotStart - dayStart;
  return dayStart + Math.ceil(offset / slotMs) * slotMs;
}

export function formatBusinessDateTime(date: Date, timeZone = DEFAULT_BUSINESS_TIMEZONE): string {
  const parts = getZonedDateTimeParts(date, timeZone);
  const hour = Math.floor(parts.minutes / 60);
  const minute = parts.minutes % 60;
  return `${parts.dateKey} ${pad2(hour)}:${pad2(minute)}`;
}

export function formatAvailableSlotForBusinessTime(
  slot: AvailableSlot,
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
) {
  const startsAt = new Date(slot.startsAt);
  const endsAt = new Date(slot.endsAt);
  const start = getZonedDateTimeParts(startsAt, timeZone);
  const end = getZonedDateTimeParts(endsAt, timeZone);
  const startHour = Math.floor(start.minutes / 60);
  const startMinute = start.minutes % 60;
  const endHour = Math.floor(end.minutes / 60);
  const endMinute = end.minutes % 60;
  const startsAtLocal = `${start.dateKey} ${pad2(startHour)}:${pad2(startMinute)}`;
  const endsAtLocal = `${end.dateKey} ${pad2(endHour)}:${pad2(endMinute)}`;

  return {
    startsAtLocal,
    endsAtLocal,
    localDate: start.dateKey,
    localStartTime: `${pad2(startHour)}:${pad2(startMinute)}`,
    localEndTime: `${pad2(endHour)}:${pad2(endMinute)}`,
    display: `${start.dateKey} ${pad2(startHour)}:${pad2(startMinute)}–${pad2(endHour)}:${pad2(endMinute)}`,
    timeZone,
    startsAtUtc: slot.startsAt,
    endsAtUtc: slot.endsAt,
    bookingValue: startsAtLocal,
  };
}

export function parseBusinessDateTime(value: string, timeZone = DEFAULT_BUSINESS_TIMEZONE): Date {
  const trimmed = value.trim();
  const localMatch = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/.exec(
    trimmed,
  );
  if (localMatch) {
    const [, dateKey, hh, mm] = localMatch;
    return zonedDateTimeToUtc(dateKey!, Number(hh) * 60 + Number(mm), timeZone);
  }
  return new Date(trimmed);
}

function parseSearchBoundary(
  value: Date | string,
  boundary: 'start' | 'end',
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
): Date {
  if (value instanceof Date) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return zonedDateTimeToUtc(value, boundary === 'start' ? 0 : 24 * 60 - 1, timeZone);
  }
  return new Date(value);
}

/**
 * Find available appointment slots for a specialist in a date range.
 *
 * @param specialistId  - The specialist to check
 * @param serviceId     - Optional service (for duration)
 * @param dateFrom      - Start of search window (ISO string or Date)
 * @param dateTo        - End of search window (ISO string or Date)
 * @returns Array of available slots sorted by start time
 */
export async function findAvailableSlots(
  specialistId: string,
  serviceId: string | null | undefined,
  dateFrom: Date | string,
  dateTo: Date | string,
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
): Promise<AvailableSlot[]> {
  const from = parseSearchBoundary(dateFrom, 'start', timeZone);
  const to = parseSearchBoundary(dateTo, 'end', timeZone);

  // Fetch specialist with working hours
  const specialist = await prisma.specialist.findUnique({
    where: { id: specialistId },
    include: { workingHours: true },
  });
  if (!specialist || !specialist.isActive) return [];

  // Fetch service duration and group capacity.
  let durationMin = DEFAULT_SLOT_DURATION_MIN;
  let isGroup = false;
  let capacity = 1;
  if (serviceId) {
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (service) {
      durationMin = service.durationMin;
      isGroup = service.isGroup;
      capacity = service.capacity;
    }
  }

  // Fetch existing (non-cancelled) appointments in range
  const existingAppointments = await prisma.appointment.findMany({
    where: {
      specialistId,
      status: { notIn: ['CANCELLED'] },
      startsAt: { lt: to },
      endsAt: { gt: from },
    },
    select: { serviceId: true, startsAt: true, endsAt: true },
  });

  // Build blocked intervals
  const blocked = existingAppointments.map((a) => ({
    serviceId: a.serviceId,
    from: a.startsAt.getTime(),
    to: a.endsAt.getTime(),
  }));

  const slots: AvailableSlot[] = [];
  const slotMs = durationMin * 60 * 1000;

  // Iterate local business days in the configured timezone.
  let currentDateKey = getZonedDateTimeParts(from, timeZone).dateKey;
  const toDateKey = getZonedDateTimeParts(to, timeZone).dateKey;

  while (currentDateKey <= toDateKey) {
    const noon = zonedDateTimeToUtc(currentDateKey, 12 * 60, timeZone);
    const dow = getZonedDateTimeParts(noon, timeZone).dayOfWeek;

    // Find working hours for this day
    const wh = specialist.workingHours.filter((h) => h.dayOfWeek === dow);
    for (const hours of wh) {
      // Build slot candidates within this working period
      const dayStart = zonedDateTimeToUtc(currentDateKey, hours.fromMinutes, timeZone);
      const dayEnd = zonedDateTimeToUtc(currentDateKey, hours.toMinutes, timeZone);

      let slotStart = alignSlotStartToGrid(
        Math.max(dayStart.getTime(), from.getTime()),
        dayStart.getTime(),
        slotMs,
      );
      const periodEnd = Math.min(dayEnd.getTime(), to.getTime());

      while (slotStart + slotMs <= periodEnd) {
        const slotEnd = slotStart + slotMs;

        const overlapping = blocked.filter((b) => slotStart < b.to && slotEnd > b.from);
        const sameGroupSlot = overlapping.filter(
          (b) =>
            isGroup &&
            serviceId &&
            b.serviceId === serviceId &&
            b.from === slotStart &&
            b.to === slotEnd,
        );
        const hasBlockingOverlap = isGroup
          ? overlapping.length !== sameGroupSlot.length ||
            sameGroupSlot.length >= Math.max(1, capacity)
          : overlapping.length > 0;

        if (!hasBlockingOverlap) {
          slots.push({
            startsAt: new Date(slotStart).toISOString(),
            endsAt: new Date(slotEnd).toISOString(),
          });
        }

        slotStart += slotMs;
      }
    }

    currentDateKey = addDaysToDateKey(currentDateKey, 1);
  }

  return slots;
}

/**
 * Check if a specific time slot is available for a specialist.
 * Used for race-condition protection when creating appointments.
 */
export async function isSlotAvailable(
  specialistId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<boolean> {
  const conflict = await prisma.appointment.findFirst({
    where: {
      specialistId,
      status: { notIn: ['CANCELLED'] },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
  });
  return conflict === null;
}

/**
 * Check whether a time slot falls within a specialist's working hours.
 * Returns false if the specialist has no working hours configured for that day.
 */
export async function isSlotWithinWorkingHours(
  specialistId: string,
  startsAt: Date,
  endsAt: Date,
  timeZone = DEFAULT_BUSINESS_TIMEZONE,
): Promise<boolean> {
  const specialist = await prisma.specialist.findUnique({
    where: { id: specialistId },
    include: { workingHours: true },
  });
  if (!specialist || !specialist.isActive) return false;

  const start = getZonedDateTimeParts(startsAt, timeZone);
  const end = getZonedDateTimeParts(endsAt, timeZone);
  if (start.dateKey !== end.dateKey) return false;

  const wh = specialist.workingHours.filter((h) => h.dayOfWeek === start.dayOfWeek);
  if (wh.length === 0) return false; // No working hours set for this day

  return wh.some((h) => h.fromMinutes <= start.minutes && end.minutes <= h.toMinutes);
}
