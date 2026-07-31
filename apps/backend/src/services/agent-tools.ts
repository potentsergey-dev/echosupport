/**
 * LLM tool definitions and execution for Phase 10.5 + 10.6.
 *
 * Tools (Phase 10.5):
 *   - request_handoff(reason)         — escalate to human operator
 *   - get_business_hours()            — get current business hours status
 *   - collect_contact(name, phone)    — save visitor contact to session
 *
 * Tools (Phase 10.6 – Booking):
 *   - list_specialists()              — list available specialists for this agent
 *   - list_services(specialist_id?)   — list available services
 *   - find_available_slots(specialist_id, service_id?, date_from, date_to) — free slots
 *   - create_appointment_request(...)  — create a PENDING appointment
 */

import type { OpenAI } from 'openai';
import { prisma } from '../db/prisma.js';
import { isBusinessHoursNow, getOutOfHoursMessage, getBusinessTimezone } from './business-hours.js';
import { publishToOperators } from './realtime-hub.js';
import {
  findAvailableSlots,
  formatAvailableSlotForBusinessTime,
  formatBusinessDateTime,
  getZonedDateTimeParts,
  isSlotWithinWorkingHours,
  parseBusinessDateTime,
} from './slot-finder.js';
import { normalizeQuickReplies } from './quick-replies.js';
import { assertSlotCanAcceptAppointment, getBookableServiceForSpecialist } from './booking.js';

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function russianNameForms(name: string): string[] {
  const trimmed = name.trim();
  if (trimmed.length < 2) return [trimmed];

  if (/а$/i.test(trimmed)) {
    const stem = trimmed.slice(0, -1);
    return [trimmed, `${stem}е`, `${stem}у`, `${stem}ой`];
  }
  if (/я$/i.test(trimmed)) {
    const stem = trimmed.slice(0, -1);
    return [trimmed, `${stem}е`, `${stem}ю`, `${stem}и`, `${stem}ей`];
  }

  return [trimmed];
}

function buildSpecialistMatchingHints(name: string): string[] {
  const parts = name.split(/\s+/).filter(Boolean);
  const [firstName, lastName] = parts;
  return uniqueStrings([
    name,
    firstName,
    lastName,
    ...russianNameForms(firstName ?? ''),
    ...russianNameForms(lastName ?? ''),
  ]);
}

// ── Tool schemas (OpenAI function-calling format) ─────────────────────────────

export const AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'suggest_replies',
      description:
        'Offer 2 to 4 short reply options when the visitor would benefit from choosing among clear next steps. Do not use for open-ended questions.',
      parameters: {
        type: 'object',
        properties: {
          replies: {
            type: 'array',
            items: { type: 'string' },
            minItems: 2,
            maxItems: 4,
            description: 'Short options written in the same language as the conversation.',
          },
        },
        required: ['replies'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_handoff',
      description:
        'Escalate this conversation to a human operator when you cannot answer, or when the user explicitly asks to speak to a human. Only call this when truly needed.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description:
              'Brief reason for escalation (e.g. "Complex legal question", "User upset")',
          },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_business_hours',
      description:
        'Get the current business hours status for this agent — whether operators are currently available.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'collect_contact',
      description:
        "Save the visitor's name and phone number to the session when they voluntarily provide it for a callback or booking.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Visitor's name (minimum 2 characters)" },
          phone: { type: 'string', description: "Visitor's phone number" },
        },
        required: ['name', 'phone'],
      },
    },
  },
  // ── Phase 10.6 Booking tools ──────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_specialists',
      description:
        'Get the list of available specialists for booking at this clinic/business. Use this when resolving a named specialist, including inflected names in the conversation such as Russian "к Еве" for "Ева". If a name or surname can refer to multiple specialists, ask the visitor to choose by full name/role.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_services',
      description:
        'Get the list of services available for booking, optionally filtered by specialist. Use this after the visitor changes specialist without naming a service, or when the previously selected service may not fit the new specialist.',
      parameters: {
        type: 'object',
        properties: {
          specialist_id: {
            type: 'string',
            description: 'Optional specialist ID to filter services for that specialist.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_available_slots',
      description:
        'Find available appointment time slots for the requested specialist. If the visitor already selected a specialist in the conversation, keep using that same specialist unless the visitor explicitly asks to change. Returns free slots in the business local timezone plus UTC audit fields.',
      parameters: {
        type: 'object',
        properties: {
          specialist_id: {
            type: 'string',
            description: 'The specialist ID to check availability for.',
          },
          service_id: {
            type: 'string',
            description: 'Optional service ID (determines slot duration).',
          },
          date_from: {
            type: 'string',
            description: 'Start of the search window as a local business date, e.g. "2026-06-01".',
          },
          date_to: {
            type: 'string',
            description: 'End of the search window as a local business date, e.g. "2026-06-07".',
          },
        },
        required: ['specialist_id', 'date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_appointment_request',
      description:
        'Create an appointment booking request. Only call after the visitor explicitly chose or confirmed one exact local date and start time, plus name, phone, specialist, and service. Do not call this tool when the visitor only gave a broad range such as "this week" or asked for help choosing a free time; use find_available_slots first and ask the visitor to pick a slot.',
      parameters: {
        type: 'object',
        properties: {
          specialist_id: { type: 'string', description: 'Specialist ID.' },
          service_id: { type: 'string', description: 'Service ID (optional).' },
          starts_at: {
            type: 'string',
            description:
              'Appointment start in business local time, preferably the bookingValue returned by find_available_slots, e.g. "2026-08-04 12:00". ISO with timezone is also accepted.',
          },
          name: { type: 'string', description: "Visitor's full name (required, min 2 chars)." },
          phone: { type: 'string', description: "Visitor's phone number (required)." },
          email: { type: 'string', description: "Visitor's email (optional)." },
        },
        required: ['specialist_id', 'starts_at', 'name', 'phone'],
      },
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────

export interface ToolExecutionContext {
  sessionId: string;
  agentId: string;
  tenantId: string;
}

export interface ToolResult {
  result: string;
  /** Side effects that need to be communicated to the SSE layer */
  sideEffect?: 'handoff_requested';
  quickReplies?: string[];
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  switch (toolName) {
    case 'suggest_replies': {
      const replies = normalizeQuickReplies(args['replies']);
      if (replies.length < 2) {
        return { result: JSON.stringify({ success: false, error: 'At least 2 replies required' }) };
      }
      return {
        result: JSON.stringify({ success: true, replies }),
        quickReplies: replies,
      };
    }

    case 'request_handoff': {
      const reason = String(args['reason'] ?? 'Unknown reason');

      // Check if within business hours
      const inHours = await isBusinessHoursNow(ctx.agentId);

      if (!inHours) {
        const outOfHoursMsg = await getOutOfHoursMessage(ctx.agentId);
        return {
          result: JSON.stringify({
            success: false,
            reason: 'out_of_hours',
            message:
              outOfHoursMsg ??
              'Operators are not available right now. Please try during business hours.',
          }),
        };
      }

      // Mark session as waiting for operator
      await prisma.session.update({
        where: { id: ctx.sessionId },
        data: {
          status: 'WAITING_OPERATOR',
          handoffRequestedAt: new Date(),
          handoffReason: reason,
        },
      });

      // Get last message snippet for notification
      const lastMsg = await prisma.message.findFirst({
        where: { sessionId: ctx.sessionId, authorType: 'VISITOR' },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });

      // Create operator notification
      await prisma.operatorNotification.create({
        data: {
          tenantId: ctx.tenantId,
          type: 'HANDOFF_REQUESTED',
          payload: {
            sessionId: ctx.sessionId,
            agentId: ctx.agentId,
            reason,
            snippet: lastMsg?.content?.slice(0, 200) ?? '',
          },
          channels: ['browser'],
        },
      });

      // Get session summary for realtime hub
      const session = await prisma.session.findUnique({
        where: { id: ctx.sessionId },
        select: {
          id: true,
          agentId: true,
          status: true,
          visitorName: true,
          pageUrl: true,
          lastActiveAt: true,
          unreadByOperator: true,
        },
      });

      if (session) {
        publishToOperators(ctx.tenantId, {
          type: 'session:new',
          tenantId: ctx.tenantId,
          session: {
            id: session.id,
            agentId: session.agentId,
            status: session.status,
            visitorName: session.visitorName,
            pageUrl: session.pageUrl,
            lastActiveAt: session.lastActiveAt,
            unreadByOperator: session.unreadByOperator,
          },
        });
      }

      return {
        result: JSON.stringify({
          success: true,
          message: 'Handoff requested. An operator has been notified.',
        }),
        sideEffect: 'handoff_requested',
      };
    }

    case 'get_business_hours': {
      const inHours = await isBusinessHoursNow(ctx.agentId);
      const outOfHoursMsg = await getOutOfHoursMessage(ctx.agentId);
      return {
        result: JSON.stringify({
          available: inHours,
          outOfHoursMessage: outOfHoursMsg,
        }),
      };
    }

    case 'collect_contact': {
      const name = String(args['name'] ?? '').trim();
      const phone = String(args['phone'] ?? '').trim();

      // Validate
      if (name.length < 2) {
        return { result: JSON.stringify({ success: false, error: 'Name too short' }) };
      }
      if (!/^\+?[\d\s\-()]{7,20}$/.test(phone)) {
        return { result: JSON.stringify({ success: false, error: 'Invalid phone number format' }) };
      }

      await prisma.session.update({
        where: { id: ctx.sessionId },
        data: { visitorName: name, visitorContact: phone },
      });

      return {
        result: JSON.stringify({ success: true, message: 'Contact saved.' }),
      };
    }

    // ── Phase 10.6 Booking tools ───────────────────────────────────────────

    case 'list_specialists': {
      const agent = await prisma.agent.findUnique({
        where: { id: ctx.agentId },
        select: { tenantId: true },
      });
      if (!agent) return { result: JSON.stringify({ error: 'Agent not found' }) };

      const specialists = await prisma.specialist.findMany({
        where: {
          tenantId: agent.tenantId,
          isActive: true,
          OR: [{ agentId: null }, { agentId: ctx.agentId }],
        },
        select: { id: true, name: true, role: true, description: true },
        orderBy: { name: 'asc' },
      });

      return {
        result: JSON.stringify({
          instruction:
            'Use matchingHints to resolve inflected or partial specialist names from the visitor. If more than one specialist matches the same hint, ask the visitor to clarify by full name/role.',
          specialists: specialists.map((specialist) => ({
            ...specialist,
            matchingHints: buildSpecialistMatchingHints(specialist.name),
          })),
        }),
      };
    }

    case 'list_services': {
      const specialistId = args['specialist_id'] ? String(args['specialist_id']) : undefined;
      const agent = await prisma.agent.findUnique({
        where: { id: ctx.agentId },
        select: { tenantId: true },
      });
      if (!agent) return { result: JSON.stringify({ error: 'Agent not found' }) };

      const where: NonNullable<Parameters<typeof prisma.service.findMany>[0]>['where'] = {
        tenantId: agent.tenantId,
        isActive: true,
      };
      if (specialistId) {
        const specialist = await prisma.specialist.findFirst({
          where: {
            id: specialistId,
            tenantId: agent.tenantId,
            isActive: true,
            OR: [{ agentId: null }, { agentId: ctx.agentId }],
          },
          select: { id: true },
        });
        if (!specialist) return { result: JSON.stringify({ services: [] }) };
        where['OR'] = [{ specialistId: null }, { specialistId }];
      }

      const services = await prisma.service.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          durationMin: true,
          priceLabel: true,
          isGroup: true,
          capacity: true,
          specialistId: true,
        },
        orderBy: { name: 'asc' },
      });

      return { result: JSON.stringify({ services }) };
    }

    case 'find_available_slots': {
      const specialistId = String(args['specialist_id'] ?? '');
      const serviceId = args['service_id'] ? String(args['service_id']) : null;
      const dateFrom = String(args['date_from'] ?? '');
      const dateTo = String(args['date_to'] ?? '');

      if (!specialistId || !dateFrom || !dateTo) {
        return {
          result: JSON.stringify({ error: 'specialist_id, date_from, date_to are required' }),
        };
      }

      const agent = await prisma.agent.findUnique({
        where: { id: ctx.agentId },
        select: { tenantId: true },
      });
      if (!agent) return { result: JSON.stringify({ error: 'Agent not found' }) };

      const specialist = await prisma.specialist.findFirst({
        where: {
          id: specialistId,
          tenantId: agent.tenantId,
          isActive: true,
          OR: [{ agentId: null }, { agentId: ctx.agentId }],
        },
        select: { id: true },
      });
      if (!specialist) return { result: JSON.stringify({ error: 'Specialist not found' }) };

      const bookableService = await getBookableServiceForSpecialist({
        tenantId: agent.tenantId,
        specialistId,
        serviceId,
      });
      if (!bookableService) {
        return { result: JSON.stringify({ error: 'Service not found for this specialist' }) };
      }

      // Limit search range to 14 days for safety
      const from = new Date(dateFrom);
      let to = new Date(dateTo);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return { result: JSON.stringify({ error: 'Invalid date range' }) };
      }
      const maxTo = new Date(from);
      maxTo.setDate(maxTo.getDate() + 14);
      if (to > maxTo) to = maxTo;

      // Set to end of day
      to.setHours(23, 59, 59, 999);

      const timeZone = await getBusinessTimezone(ctx.agentId);
      const now = new Date();
      const todayKey = getZonedDateTimeParts(now, timeZone).dateKey;
      const requestedFromKey = /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)
        ? dateFrom
        : getZonedDateTimeParts(from, timeZone).dateKey;
      const dateFromForSearch: Date | string = requestedFromKey <= todayKey ? now : dateFrom;
      const dateToForSearch = to > maxTo ? getZonedDateTimeParts(maxTo, timeZone).dateKey : dateTo;
      const slots = await findAvailableSlots(
        specialistId,
        bookableService.id,
        dateFromForSearch,
        dateToForSearch,
        timeZone,
      );

      // Return at most 20 slots to keep context manageable
      return {
        result: JSON.stringify({
          timeZone,
          instruction:
            'These slots are already converted to local business time. Show display/local times to the visitor. Use bookingValue as starts_at when creating an appointment.',
          slots: slots
            .slice(0, 20)
            .map((slot) => formatAvailableSlotForBusinessTime(slot, timeZone)),
        }),
      };
    }

    case 'create_appointment_request': {
      const specialistId = String(args['specialist_id'] ?? '');
      const serviceId = args['service_id'] ? String(args['service_id']) : undefined;
      const startsAtStr = String(args['starts_at'] ?? '');
      const name = String(args['name'] ?? '').trim();
      const phone = String(args['phone'] ?? '').trim();
      const email = args['email'] ? String(args['email']).trim() : undefined;

      // Validate inputs
      if (!specialistId)
        return { result: JSON.stringify({ success: false, error: 'specialist_id required' }) };
      if (!startsAtStr)
        return { result: JSON.stringify({ success: false, error: 'starts_at required' }) };
      if (name.length < 2)
        return {
          result: JSON.stringify({ success: false, error: 'Name too short (min 2 chars)' }),
        };
      if (!/^\+?[\d\s\-().]{7,20}$/.test(phone)) {
        return { result: JSON.stringify({ success: false, error: 'Invalid phone number format' }) };
      }

      const timeZone = await getBusinessTimezone(ctx.agentId);
      const startsAt = parseBusinessDateTime(startsAtStr, timeZone);
      if (isNaN(startsAt.getTime())) {
        return { result: JSON.stringify({ success: false, error: 'Invalid starts_at datetime' }) };
      }
      if (startsAt.getTime() < Date.now()) {
        return {
          result: JSON.stringify({
            success: false,
            error: 'Appointment time must be in the future',
          }),
        };
      }

      // Verify specialist exists and belongs to agent's tenant
      const agent = await prisma.agent.findUnique({
        where: { id: ctx.agentId },
        select: { tenantId: true },
      });
      if (!agent) return { result: JSON.stringify({ success: false, error: 'Agent not found' }) };

      const specialist = await prisma.specialist.findFirst({
        where: {
          id: specialistId,
          tenantId: agent.tenantId,
          isActive: true,
          OR: [{ agentId: null }, { agentId: ctx.agentId }],
        },
      });
      if (!specialist)
        return { result: JSON.stringify({ success: false, error: 'Specialist not found' }) };

      const bookableService = await getBookableServiceForSpecialist({
        tenantId: agent.tenantId,
        specialistId,
        serviceId,
      });
      if (!bookableService) {
        return {
          result: JSON.stringify({
            success: false,
            error: 'Service not found for this specialist',
          }),
        };
      }
      const endsAt = new Date(startsAt.getTime() + bookableService.durationMin * 60 * 1000);

      // Validate slot is within specialist's working hours
      const withinHours = await isSlotWithinWorkingHours(specialistId, startsAt, endsAt, timeZone);
      if (!withinHours) {
        return {
          result: JSON.stringify({
            success: false,
            error:
              "The requested time is outside the specialist's working hours. Use find_available_slots to see valid times.",
          }),
        };
      }

      // Race-condition safe slot check + create in transaction
      const appointment = await prisma
        .$transaction(async (tx) => {
          await assertSlotCanAcceptAppointment({
            specialistId,
            serviceId: bookableService.id,
            startsAt,
            endsAt,
            isGroup: bookableService.isGroup,
            capacity: bookableService.capacity,
            db: tx,
          });

          return tx.appointment.create({
            data: {
              tenantId: agent.tenantId,
              agentId: ctx.agentId,
              sessionId: ctx.sessionId,
              specialistId,
              serviceId: bookableService.id,
              visitorName: name,
              visitorPhone: phone,
              visitorEmail: email ?? null,
              startsAt,
              endsAt,
              status: 'PENDING',
              source: 'AGENT',
            },
          });
        })
        .catch((err: Error) => {
          if (err.message === 'SLOT_TAKEN' || err.message === 'SLOT_FULL') return err.message;
          throw err;
        });

      if (appointment === 'SLOT_TAKEN' || appointment === 'SLOT_FULL') {
        return {
          result: JSON.stringify({
            success: false,
            error:
              appointment === 'SLOT_FULL'
                ? 'This group session is already full. Please choose another time.'
                : 'That time slot is no longer available. Please choose another slot.',
          }),
        };
      }

      // Save visitor contact to session as well
      await prisma.session
        .update({
          where: { id: ctx.sessionId },
          data: { visitorName: name, visitorContact: phone },
        })
        .catch(() => {
          /* ignore if session doesn't exist */
        });

      // Notify operators
      await prisma.operatorNotification.create({
        data: {
          tenantId: agent.tenantId,
          type: 'NEW_APPOINTMENT',
          payload: {
            appointmentId: appointment.id,
            sessionId: ctx.sessionId,
            specialistName: specialist.name,
            visitorName: name,
            visitorPhone: phone,
            startsAt: startsAt.toISOString(),
          },
          channels: ['browser'],
        },
      });

      publishToOperators(agent.tenantId, {
        type: 'appointment:new',
        tenantId: agent.tenantId,
        appointment: {
          id: appointment.id,
          specialistName: specialist.name,
          visitorName: name,
          startsAt: startsAt.toISOString(),
          status: 'PENDING',
        },
      });

      return {
        result: JSON.stringify({
          success: true,
          appointmentId: appointment.id,
          message: `Appointment booked for ${name} on ${formatBusinessDateTime(startsAt, timeZone)} (${timeZone}). Status: PENDING — awaiting operator confirmation.`,
        }),
      };
    }

    default:
      return { result: JSON.stringify({ error: `Unknown tool: ${toolName}` }) };
  }
}
