import { createHash } from 'node:crypto';
import type { AppointmentStatus, Prisma } from '@prisma/client';
import { DEFAULT_BUSINESS_TIMEZONE, isSlotWithinWorkingHours } from './slot-finder.js';
import { prisma } from '../db/prisma.js';
import {
  assertSlotCanAcceptAppointment,
  getAppointmentParticipantCount,
  getStoredParticipantCount,
} from './booking.js';
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
  participantCount?: number | undefined;
  bookingRequestKey?: string | undefined;
}

async function lockBookingTimezone(
  tx: Prisma.TransactionClient,
  tenantId: string,
  agentId?: string | null,
): Promise<string> {
  const agents = agentId
    ? await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Agent" WHERE id=${agentId} AND "tenantId"=${tenantId} AND "isActive"=true FOR SHARE`
    : await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Agent" WHERE "tenantId"=${tenantId} AND "isActive"=true ORDER BY id FOR SHARE`;
  if (agentId && !agents.length) throw new Error('BOOKING_UNAVAILABLE');
  const hours = agents.length
    ? await tx.businessHours.findMany({
        where: { agentId: { in: agents.map((agent) => agent.id) } },
        select: { agentId: true, timezone: true },
      })
    : [];
  const timezones = new Set(
    agents.map(
      (agent) =>
        hours.find((row) => row.agentId === agent.id)?.timezone ?? DEFAULT_BUSINESS_TIMEZONE,
    ),
  );
  if (timezones.size > 1) throw new Error('BOOKING_TIMEZONE_REQUIRED');
  return timezones.values().next().value ?? DEFAULT_BUSINESS_TIMEZONE;
}

/** All create callers serialize on the persisted specialist, even for empty slots.
 * No retries after an ambiguous commit. Agent retries can only find their own session. */
export async function createBooking(input: CreateBookingInput, db = prisma) {
  return db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const bookingRequestHash = input.bookingRequestKey
        ? createHash('sha256')
            .update(
              JSON.stringify({
                specialistId: input.specialistId,
                serviceId: input.serviceId,
                startsAt: input.startsAt.toISOString(),
                endsAt: input.endsAt.toISOString(),
                visitorName: input.visitorName,
                visitorPhone: input.visitorPhone,
                visitorEmail: input.visitorEmail ?? null,
                participantCount: input.participantCount ?? null,
                notes: input.notes ?? null,
                sessionId: input.sessionId ?? null,
              }),
            )
            .digest('hex')
        : null;
      if (input.bookingRequestKey) {
        if (input.source !== 'OPERATOR') throw new Error('BOOKING_UNAVAILABLE');
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.tenantId + ':' + input.bookingRequestKey}, 0))::text`;
        const previous = await tx.appointment.findFirst({
          where: { tenantId: input.tenantId, bookingRequestKey: input.bookingRequestKey },
          include: {
            specialist: { select: { id: true, name: true, role: true } },
            service: { select: { id: true, name: true, isGroup: true, capacity: true } },
          },
        });
        if (previous) {
          if (previous.bookingRequestHash !== bookingRequestHash)
            throw new Error('BOOKING_REQUEST_CONFLICT');
          return previous;
        }
      }
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
      const participantCount =
        input.participantCount ??
        (service?.isGroup ? getAppointmentParticipantCount(input.notes) : 1);
      if (
        !Number.isInteger(participantCount) ||
        participantCount < 1 ||
        participantCount > 2147483647 ||
        (!service?.isGroup && participantCount !== 1)
      )
        throw new Error('BOOKING_INVALID_PARTICIPANTS');
      const duration = service?.durationMin ?? 60;
      if (
        !Number.isFinite(input.startsAt.getTime()) ||
        !Number.isFinite(input.endsAt.getTime()) ||
        input.startsAt <= new Date() ||
        input.endsAt.getTime() - input.startsAt.getTime() !== duration * 60_000
      )
        throw new Error('BOOKING_UNAVAILABLE');
      const linkedSession = input.sessionId
        ? await tx.session.findFirst({
            where: { id: input.sessionId, agent: { tenantId: input.tenantId } },
            select: { agentId: true },
          })
        : null;
      if (input.sessionId && !linkedSession) throw new Error('BOOKING_UNAVAILABLE');
      const businessAgentId = input.agentId ?? specialist.agentId ?? linkedSession?.agentId;
      const timezone = await lockBookingTimezone(tx, input.tenantId, businessAgentId);
      if (
        !(await isSlotWithinWorkingHours(
          input.specialistId,
          input.startsAt,
          input.endsAt,
          timezone,
          tx,
        ))
      )
        throw new Error('BOOKING_OUTSIDE_HOURS');
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
        requestedParticipants: participantCount,
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
            participantCount,
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
      return tx.appointment.create({
        data: {
          ...input,
          participantCount,
          bookingRequestHash,
          bookingRequestKey: input.bookingRequestKey ?? null,
        },
        include,
      });
    },
    { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 },
  );
}

interface UpdateBookingInput {
  participantCount?: number | undefined;
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
      if (
        appointment.status === 'CANCELLED' &&
        status !== 'CANCELLED' &&
        status !== 'PENDING' &&
        status !== 'CONFIRMED'
      )
        throw new Error('BOOKING_UNAVAILABLE');
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
      const participantCount = input.participantCount ?? appointment.participantCount;
      if (
        input.participantCount !== undefined &&
        (!Number.isInteger(input.participantCount) ||
          input.participantCount < 1 ||
          input.participantCount > 2147483647 ||
          (!service?.isGroup && input.participantCount !== 1))
      )
        throw new Error('BOOKING_INVALID_PARTICIPANTS');
      const resolvingLegacyCount =
        appointment.participantCount === null && input.participantCount !== undefined;
      const admission =
        active &&
        (!!input.startsAt ||
          status !== appointment.status ||
          (input.participantCount !== undefined && !resolvingLegacyCount));
      if (admission) {
        if (!specialist.isActive || !Number.isFinite(startsAt.getTime()) || startsAt <= new Date())
          throw new Error('BOOKING_UNAVAILABLE');
        if (
          appointment.serviceId &&
          (!service?.isActive ||
            (service.specialistId !== null && service.specialistId !== specialist.id))
        )
          throw new Error('BOOKING_UNAVAILABLE');
        const linkedSession = appointment.sessionId
          ? await tx.session.findFirst({
              where: { id: appointment.sessionId, agent: { tenantId } },
              select: { agentId: true },
            })
          : null;
        const agentId = appointment.agentId ?? specialist.agentId ?? linkedSession?.agentId;
        const timezone = await lockBookingTimezone(tx, tenantId, agentId);
        if (
          !(await isSlotWithinWorkingHours(
            appointment.specialistId,
            startsAt,
            endsAt,
            timezone,
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
          requestedParticipants: getStoredParticipantCount({
            ...appointment,
            participantCount,
            participantCountReviewReason:
              input.participantCount !== undefined
                ? null
                : appointment.participantCountReviewReason,
          }),
          excludeAppointmentId: id,
          db: tx,
        });
      }
      const data: Prisma.AppointmentUpdateInput = { status };
      if (input.participantCount !== undefined) {
        data.participantCount = input.participantCount;
        data.participantCountReviewReason = null;
      }
      if (input.startsAt) Object.assign(data, { startsAt, endsAt });
      if (input.notes !== undefined) data.notes = input.notes;
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
