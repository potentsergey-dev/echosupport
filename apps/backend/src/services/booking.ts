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
}

export async function getBookableServiceForSpecialist({
  tenantId,
  specialistId,
  serviceId,
}: {
  tenantId: string;
  specialistId: string;
  serviceId?: string | null | undefined;
}): Promise<BookableServiceResult | null> {
  if (!serviceId) return { id: null, durationMin: 60 };

  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      tenantId,
      isActive: true,
      OR: [{ specialistId: null }, { specialistId }],
    },
    select: { id: true, durationMin: true },
  });

  if (!service) return null;
  return { id: service.id, durationMin: service.durationMin };
}
