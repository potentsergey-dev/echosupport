import type { Prisma } from '@prisma/client';
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
