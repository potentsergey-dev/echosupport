import type { AppointmentStatus, Prisma } from '@prisma/client';
import { DEFAULT_BUSINESS_TIMEZONE, isSlotWithinWorkingHours } from './slot-finder.js';
import { prisma } from '../db/prisma.js';
import { assertSlotCanAcceptAppointment, getAppointmentParticipantCount } from './booking.js';
import { filterServicesForSpecialist } from './specialist-services.js';

interface CreateBookingInput {
  tenantId: string;
  specialistId: string;
  serviceId: string | null;
  agentId?: string;
  sessionId?: string | null;
  visitorName: string;
  visitorPhone: string;
  visitorEmail?: string | null;
  startsAt: Date;
  endsAt: Date;
  source: 'AGENT' | 'OPERATOR';
  notes?: string | null;
  createdByUserId?: string;
}

/** All create callers serialize on the persisted specialist, even for empty slots.
 * No retries after an ambiguous commit. Agent retries can only find their own session. */
export async function createBooking(input: CreateBookingInput, db = prisma) {
  return db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const locked = await tx.$queryRaw<
        { id: string; description: string | null; agentId: string | null }[]
      >`
      SELECT "id", "description", "agentId" FROM "Specialist"
      WHERE "id"=${input.specialistId} AND "tenantId"=${input.tenantId} AND "isActive"=true
      FOR UPDATE`;
      const specialist = locked[0];
      if (!specialist) throw new Error('BOOKING_UNAVAILABLE');
      if (input.source === 'AGENT') {
        if (
          !input.agentId ||
          !input.sessionId ||
          (specialist.agentId && specialist.agentId !== input.agentId)
        )
          throw new Error('BOOKING_UNAVAILABLE');
        const session = await tx.session.findFirst({
          where: {
            id: input.sessionId,
            agentId: input.agentId,
            closedAt: null,
            expiresAt: { gt: new Date() },
            agent: { tenantId: input.tenantId, isActive: true },
          },
          select: { id: true },
        });
        if (!session) throw new Error('BOOKING_UNAVAILABLE');
      }
      // Pin service configuration until commit; never trust an earlier capacity snapshot.
      if (input.serviceId)
        await tx.$queryRaw`
      SELECT "id" FROM "Service" WHERE "id"=${input.serviceId} AND "tenantId"=${input.tenantId} FOR SHARE`;
      const services = input.serviceId
        ? await tx.service.findMany({
            where: {
              tenantId: input.tenantId,
              isActive: true,
              OR: [{ specialistId: null }, { specialistId: input.specialistId }],
            },
          })
        : [];
      const service = filterServicesForSpecialist(specialist, services).find(
        (s) => s.id === input.serviceId,
      );
      if (input.serviceId && !service) throw new Error('BOOKING_UNAVAILABLE');
      const duration = service?.durationMin ?? 60;
      if (
        !Number.isFinite(input.startsAt.getTime()) ||
        !Number.isFinite(input.endsAt.getTime()) ||
        input.startsAt <= new Date() ||
        input.endsAt.getTime() - input.startsAt.getTime() !== duration * 60_000
      )
        throw new Error('BOOKING_UNAVAILABLE');
      const existing =
        input.source === 'AGENT'
          ? await tx.appointment.findFirst({
              where: {
                tenantId: input.tenantId,
                agentId: input.agentId!,
                sessionId: input.sessionId!,
                specialistId: input.specialistId,
                serviceId: input.serviceId,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                status: { in: ['PENDING', 'CONFIRMED'] },
              },
              orderBy: { id: 'asc' },
              select: {
                id: true,
                status: true,
                visitorName: true,
                visitorPhone: true,
                visitorEmail: true,
                notes: true,
              },
            })
          : null;
      await assertSlotCanAcceptAppointment({
        specialistId: input.specialistId,
        serviceId: input.serviceId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        isGroup: service?.isGroup ?? false,
        capacity: service?.capacity ?? 1,
        requestedParticipants: service?.isGroup ? getAppointmentParticipantCount(input.notes) : 1,
        ...(existing ? { excludeAppointmentId: existing.id } : {}),
        db: tx,
      });
      const include = {
        specialist: { select: { id: true, name: true, role: true } },
        service: { select: { id: true, name: true, isGroup: true, capacity: true } },
      } as const;
      if (existing)
        return tx.appointment.update({
          where: { id: existing.id },
          data: {
            visitorName: input.visitorName,
            visitorPhone: input.visitorPhone,
            visitorEmail: input.visitorEmail ?? null,
            notes: input.notes ?? null,
            status:
              existing.visitorName === input.visitorName &&
              existing.visitorPhone === input.visitorPhone &&
              existing.visitorEmail === (input.visitorEmail ?? null) &&
              existing.notes === (input.notes ?? null)
                ? existing.status
                : 'PENDING',
          },
          include,
        });
      return tx.appointment.create({ data: input, include });
    },
    { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 },
  );
}

interface UpdateBookingInput {
  status?: AppointmentStatus | undefined;
  startsAt?: Date | undefined;
  notes?: string | null | undefined;
  visitorName?: string | undefined;
  visitorPhone?: string | undefined;
  visitorEmail?: string | null | undefined;
}

/** All operator mutations serialize with creation, including edits that release seats. */
export async function updateBooking(
  tenantId: string,
  id: string,
  input: UpdateBookingInput,
  db = prisma,
) {
  return db.$transaction(
    async (tx) => {
      const reference = await tx.appointment.findFirst({
        where: { id, tenantId },
        select: { specialistId: true },
      });
      if (!reference) throw new Error('BOOKING_NOT_FOUND');
      const locked = await tx.$queryRaw<
        { id: string; isActive: boolean; description: string | null; agentId: string | null }[]
      >`
      SELECT "id", "isActive", "description", "agentId" FROM "Specialist"
      WHERE "id"=${reference.specialistId} AND "tenantId"=${tenantId} FOR UPDATE`;
      const appointment = await tx.appointment.findFirst({ where: { id, tenantId } });
      if (!appointment) throw new Error('BOOKING_NOT_FOUND');
      const specialist = locked[0];
      if (!specialist || appointment.specialistId !== reference.specialistId)
        throw new Error('BOOKING_UNAVAILABLE');
      const terminal = appointment.status === 'COMPLETED' || appointment.status === 'NO_SHOW';
      const status = input.startsAt ? 'PENDING' : (input.status ?? appointment.status);
      if (terminal && (input.startsAt || status !== appointment.status))
        throw new Error('BOOKING_UNAVAILABLE');
      if (appointment.serviceId)
        await tx.$queryRaw`SELECT "id" FROM "Service" WHERE "id"=${appointment.serviceId} AND "tenantId"=${tenantId} FOR SHARE`;
      const service = appointment.serviceId
        ? await tx.service.findFirst({ where: { id: appointment.serviceId, tenantId } })
        : null;
      const startsAt = input.startsAt ?? appointment.startsAt;
      const endsAt = input.startsAt
        ? new Date(startsAt.getTime() + (service?.durationMin ?? 60) * 60_000)
        : appointment.endsAt;
      const active = status === 'PENDING' || status === 'CONFIRMED';
      const admission = active && (!!input.startsAt || status !== appointment.status);
      if (admission) {
        if (!specialist.isActive || !Number.isFinite(startsAt.getTime()) || startsAt <= new Date())
          throw new Error('BOOKING_UNAVAILABLE');
        if (
          appointment.serviceId &&
          (!service?.isActive ||
            (service.specialistId !== null && service.specialistId !== specialist.id))
        )
          throw new Error('BOOKING_UNAVAILABLE');
        const agentId = appointment.agentId ?? specialist.agentId;
        const hours = agentId
          ? await tx.businessHours.findUnique({ where: { agentId }, select: { timezone: true } })
          : null;
        if (
          !(await isSlotWithinWorkingHours(
            appointment.specialistId,
            startsAt,
            endsAt,
            hours?.timezone ?? DEFAULT_BUSINESS_TIMEZONE,
            tx,
          ))
        )
          throw new Error('BOOKING_OUTSIDE_HOURS');
        await assertSlotCanAcceptAppointment({
          specialistId: appointment.specialistId,
          serviceId: appointment.serviceId,
          startsAt,
          endsAt,
          isGroup: service?.isGroup ?? false,
          capacity: service?.capacity ?? 1,
          requestedParticipants: service?.isGroup
            ? getAppointmentParticipantCount(appointment.notes)
            : 1,
          excludeAppointmentId: id,
          db: tx,
        });
      }
      // Until participantCount is migrated, free-text edits must preserve the persisted seat count.
      const data: Prisma.AppointmentUpdateInput = { status };
      if (input.startsAt) Object.assign(data, { startsAt, endsAt });
      if (input.notes !== undefined) {
        const count = getAppointmentParticipantCount(appointment.notes);
        const hasLegacyCount = /Group participants:/i.test(appointment.notes ?? '');
        data.notes =
          service?.isGroup || hasLegacyCount
            ? `Group participants: ${count}\n${(input.notes ?? '').replace(/Group participants:\s*\d+/gi, '').trim()}`.trim()
            : input.notes;
      }
      if (input.visitorName !== undefined) data.visitorName = input.visitorName;
      if (input.visitorPhone !== undefined) data.visitorPhone = input.visitorPhone;
      if (input.visitorEmail !== undefined) data.visitorEmail = input.visitorEmail;
      return tx.appointment.update({
        where: { id },
        data,
        include: {
          specialist: { select: { id: true, name: true } },
          service: { select: { id: true, name: true, isGroup: true, capacity: true } },
        },
      });
    },
    { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 },
  );
}

export async function confirmBooking(tenantId: string, id: string, db = prisma) {
  return updateBooking(tenantId, id, { status: 'CONFIRMED' }, db);
}
