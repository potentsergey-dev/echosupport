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
): Promise<AvailableSlot[]> {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);

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

  // Iterate day by day
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);

  while (current <= to) {
    const dow = current.getDay(); // 0=Sunday

    // Find working hours for this day
    const wh = specialist.workingHours.filter((h) => h.dayOfWeek === dow);
    for (const hours of wh) {
      // Build slot candidates within this working period
      const dayStart = new Date(current);
      dayStart.setHours(
        0,
        hours.fromMinutes % 60 === 0 ? Math.floor(hours.fromMinutes / 60) : 0,
        0,
        0,
      );
      dayStart.setMinutes(hours.fromMinutes % 60 === 0 ? 0 : hours.fromMinutes % 60);
      dayStart.setHours(Math.floor(hours.fromMinutes / 60), hours.fromMinutes % 60, 0, 0);

      const dayEnd = new Date(current);
      dayEnd.setHours(Math.floor(hours.toMinutes / 60), hours.toMinutes % 60, 0, 0);

      let slotStart = Math.max(dayStart.getTime(), from.getTime());
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

    current.setDate(current.getDate() + 1);
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
): Promise<boolean> {
  const specialist = await prisma.specialist.findUnique({
    where: { id: specialistId },
    include: { workingHours: true },
  });
  if (!specialist || !specialist.isActive) return false;

  const dow = startsAt.getDay(); // 0 = Sunday
  const wh = specialist.workingHours.filter((h) => h.dayOfWeek === dow);
  if (wh.length === 0) return false; // No working hours set for this day

  const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
  const endMinutes = endsAt.getHours() * 60 + endsAt.getMinutes();

  return wh.some((h) => h.fromMinutes <= startMinutes && endMinutes <= h.toMinutes);
}
