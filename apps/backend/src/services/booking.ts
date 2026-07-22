import { z } from 'zod';
import { prisma } from '../db/prisma.js';

export const APPOINTMENT_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
] as const;

export const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export interface WorkingRange {
  dayOfWeek: number;
  fromMinutes: number;
  toMinutes: number;
}

export function hasOverlappingWorkingRanges(entries: WorkingRange[]): boolean {
  const byDay = new Map<number, WorkingRange[]>();
  for (const entry of entries) {
    const dayEntries = byDay.get(entry.dayOfWeek) ?? [];
    dayEntries.push(entry);
    byDay.set(entry.dayOfWeek, dayEntries);
  }

  for (const dayEntries of byDay.values()) {
    dayEntries.sort((a, b) => a.fromMinutes - b.fromMinutes);
    for (let index = 1; index < dayEntries.length; index += 1) {
      const previous = dayEntries[index - 1]!;
      const current = dayEntries[index]!;
      if (current.fromMinutes < previous.toMinutes) return true;
    }
  }

  return false;
}

export interface BookableServiceResult {
  id: string | null;
  durationMin: number;
  isGroup: boolean;
  capacity: number;
}

export type SlotAvailabilityError = 'SLOT_TAKEN' | 'SLOT_FULL';

export async function getBookableServiceForSpecialist({
  tenantId,
  specialistId,
  serviceId,
}: {
  tenantId: string;
  specialistId: string;
  serviceId?: string | null | undefined;
}): Promise<BookableServiceResult | null> {
  if (!serviceId) return { id: null, durationMin: 60, isGroup: false, capacity: 1 };

  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      tenantId,
      isActive: true,
      OR: [{ specialistId: null }, { specialistId }],
    },
    select: { id: true, durationMin: true, isGroup: true, capacity: true },
  });

  if (!service) return null;
  return {
    id: service.id,
    durationMin: service.durationMin,
    isGroup: service.isGroup,
    capacity: service.capacity,
  };
}

export async function assertSlotCanAcceptAppointment({
  specialistId,
  serviceId,
  startsAt,
  endsAt,
  isGroup,
  capacity,
  excludeAppointmentId,
  db = prisma,
}: {
  specialistId: string;
  serviceId: string | null;
  startsAt: Date;
  endsAt: Date;
  isGroup: boolean;
  capacity: number;
  excludeAppointmentId?: string;
  db?: Pick<typeof prisma, 'appointment'>;
}): Promise<void> {
  const overlappingAppointments = await db.appointment.findMany({
    where: {
      specialistId,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    select: { id: true, serviceId: true, startsAt: true, endsAt: true },
  });

  if (!isGroup || !serviceId) {
    if (overlappingAppointments.length > 0) throw new Error('SLOT_TAKEN');
    return;
  }

  const isSameGroupSlot = (appointment: (typeof overlappingAppointments)[number]) =>
    appointment.serviceId === serviceId &&
    appointment.startsAt.getTime() === startsAt.getTime() &&
    appointment.endsAt.getTime() === endsAt.getTime();

  if (overlappingAppointments.some((appointment) => !isSameGroupSlot(appointment))) {
    throw new Error('SLOT_TAKEN');
  }

  const occupiedSeats = overlappingAppointments.filter(isSameGroupSlot).length;
  if (occupiedSeats >= Math.max(1, capacity)) throw new Error('SLOT_FULL');
}
