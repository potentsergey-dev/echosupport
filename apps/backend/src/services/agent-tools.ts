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
import {
  buildSlotQuickReplies,
  matchSpecialistsByName,
  resolveRelativeBookingDateRange,
} from './booking-tool-utils.js';
import { getActiveServicesForSpecialist } from './specialist-services.js';
import type { BookingContext } from './booking-context.js';
import { hasExplicitBookingDateTime } from './booking-context.js';

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function russianNameForms(name: string): string[] {
  const trimmed = name.trim();
  if (trimmed.length < 2) return [trimmed];

  if (/а$/i.test(trimmed)) {
    const stem = trimmed.slice(0, -1);
    return [trimmed, `${stem}ы`, `${stem}е`, `${stem}у`, `${stem}ой`];
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

function normalizeBookingLookup(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
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
        'Find available appointment time slots. Pass a specialist when the visitor chose one. When a service and date are known but no specialist was chosen, pass service_id or service_name without a specialist: the server returns grouped slots for every compatible specialist. Returns free slots in the business local timezone plus UTC audit fields.',
      parameters: {
        type: 'object',
        properties: {
          specialist_id: {
            type: 'string',
            description: 'The specialist ID to check availability for, when confidently known.',
          },
          specialist_name: {
            type: 'string',
            description:
              'Specialist name from the visitor, including partial or inflected forms such as "Еве" or "Анне". Send this when specialist_id is unknown or uncertain; the server resolves it.',
          },
          service_id: {
            type: 'string',
            description: 'Service ID (determines slot duration).',
          },
          service_name: {
            type: 'string',
            description:
              'Service name from the visitor, for example "Dimensional color", when service_id is unavailable or uncertain.',
          },
          date_from: {
            type: 'string',
            description: 'Start of the search window as a local business date, e.g. "2026-06-01".',
          },
          date_to: {
            type: 'string',
            description: 'End of the search window as a local business date, e.g. "2026-06-07".',
          },
          relative_date: {
            type: 'string',
            enum: ['today', 'tomorrow', 'this_week', 'next_week'],
            description:
              'Use for a relative visitor request. The server deterministically converts weeks to Monday-Sunday in business time.',
          },
          search_next_available: {
            type: 'boolean',
            description:
              'Use only when the visitor asks which other dates or next available slots exist after a previous unavailable result. The server searches the next 14 local calendar days, so omit date_from and date_to.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_appointment_request',
      description:
        'Create an appointment booking request, including group-service bookings. Call after the visitor explicitly chose or confirmed one exact local date and start time, plus name, phone, specialist, and service. Always pass service_id or service_name; appointments must not be created without a service. For group services, ask how many people the visitor wants to book before calling this tool, then pass group_participants. Prefer IDs returned by booking tools, but if an ID is unavailable pass specialist_name and service_name; the backend will resolve them. A group slot returned by find_available_slots is bookable; call this tool and let the backend enforce capacity instead of refusing it. Do not call when the visitor only gave a broad range such as "this week" or asked for help choosing a free time; use find_available_slots first and ask the visitor to pick a slot.',
      parameters: {
        type: 'object',
        properties: {
          specialist_id: { type: 'string', description: 'Specialist ID.' },
          specialist_name: {
            type: 'string',
            description:
              'Specialist name from the visitor or previous tool result, e.g. "Ева Король", when specialist_id is unavailable or uncertain.',
          },
          service_id: { type: 'string', description: 'Service ID (optional).' },
          service_name: {
            type: 'string',
            description:
              'Service name from the visitor or previous tool result, e.g. "Face practice", when service_id is unavailable or uncertain.',
          },
          starts_at: {
            type: 'string',
            description:
              'Appointment start in business local time, preferably the bookingValue returned by find_available_slots, e.g. "2026-08-04 12:00". ISO with timezone is also accepted.',
          },
          name: { type: 'string', description: "Visitor's full name (required, min 2 chars)." },
          phone: { type: 'string', description: "Visitor's phone number (required)." },
          email: { type: 'string', description: "Visitor's email (optional)." },
          group_participants: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description:
              'For group services, the number of people the visitor wants to book, including themselves. Ask before booking if unknown.',
          },
        },
        required: ['starts_at', 'name', 'phone'],
      },
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────

export interface ToolExecutionContext {
  sessionId: string;
  agentId: string;
  tenantId: string;
  bookingContext?: BookingContext | null;
  visitorText?: string;
}

function pendingBookingDateResult(): ToolResult {
  return {
    result: JSON.stringify({
      error: 'DATE_REQUIRED_FOR_NEW_SERVICE',
      instruction:
        'The visitor changed to a new service without providing a date. Ask only which date they want before requesting contacts, participants, availability, or creating an appointment.',
    }),
  };
}

function bookingSelectionRequiredResult(): ToolResult {
  return {
    result: JSON.stringify({
      error: 'EXPLICIT_SLOT_SELECTION_REQUIRED',
      instruction:
        'Do not create an appointment yet. Ask the visitor to choose one exact date and time from the available slots.',
    }),
  };
}
function matchesSelectedSlotTime(ctx: ToolExecutionContext, startsAt: string): boolean {
  const selectedSlotTime = ctx.bookingContext?.selectedSlotTime;
  if (!selectedSlotTime) return true;
  return startsAt.includes(` ${selectedSlotTime}`) || startsAt.includes(`T${selectedSlotTime}`);
}

function selectedSlotMismatchResult(): ToolResult {
  return {
    result: JSON.stringify({
      error: 'SELECTED_SLOT_TIME_MISMATCH',
      instruction:
        'Do not create an appointment for a different time. Use the exact time the visitor selected, or ask them to choose a slot again.',
    }),
  };
}
function needsNewBookingDate(
  ctx: ToolExecutionContext,
  serviceId: string | undefined,
  serviceName: string,
): boolean {
  const bookingContext = ctx.bookingContext;
  if (!bookingContext?.needsDate) return false;
  return (
    bookingContext.serviceId === serviceId ||
    normalizeBookingLookup(bookingContext.serviceName) === normalizeBookingLookup(serviceName)
  );
}
export interface ToolResult {
  result: string;
  /** Side effects that need to be communicated to the SSE layer */
  sideEffect?: 'handoff_requested';
  quickReplies?: string[];
}

function selectedBookingServiceMismatchResult(bookingContext: BookingContext): ToolResult {
  return {
    result: JSON.stringify({
      error: 'SELECTED_SERVICE_MISMATCH',
      instruction: `The visitor has already selected "${bookingContext.serviceName}". Keep that exact service and search for slots; do not ask for confirmation or switch to another service unless the visitor explicitly names one.`,
    }),
  };
}

function selectedBookingSpecialistMismatchResult(bookingContext: BookingContext): ToolResult {
  return {
    result: JSON.stringify({
      error: 'SELECTED_SPECIALIST_MISMATCH',
      instruction: `The visitor has already selected "${bookingContext.specialistName}". Keep that exact specialist and search for slots unless the visitor explicitly names another specialist.`,
    }),
  };
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

      let services;
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
        services = await getActiveServicesForSpecialist({
          tenantId: agent.tenantId,
          specialistId,
        });
      } else {
        services = await prisma.service.findMany({
          where: { tenantId: agent.tenantId, isActive: true },
          orderBy: { name: 'asc' },
        });
      }

      return {
        result: JSON.stringify({
          services: services.map(
            ({
              id,
              name,
              description,
              durationMin,
              priceLabel,
              isGroup,
              capacity,
              specialistId,
            }) => ({
              id,
              name,
              description,
              durationMin,
              priceLabel,
              isGroup,
              capacity,
              specialistId,
            }),
          ),
        }),
      };
    }

    case 'find_available_slots': {
      let specialistId = String(args['specialist_id'] ?? '').trim();
      let specialistName = String(args['specialist_name'] ?? '').trim();
      let serviceId = args['service_id'] ? String(args['service_id']).trim() : '';
      let serviceName = String(args['service_name'] ?? '').trim();
      let dateFrom = String(args['date_from'] ?? '');
      let dateTo = String(args['date_to'] ?? '');
      const searchNextAvailable = args['search_next_available'] === true;
      const selectedBooking = ctx.bookingContext;

      if (selectedBooking) {
        const suppliedDifferentService =
          (serviceId && serviceId !== selectedBooking.serviceId) ||
          (serviceName &&
            normalizeBookingLookup(serviceName) !==
              normalizeBookingLookup(selectedBooking.serviceName));
        if (suppliedDifferentService) return selectedBookingServiceMismatchResult(selectedBooking);

        serviceId = selectedBooking.serviceId;
        serviceName = selectedBooking.serviceName;

        if (selectedBooking.specialistId) {
          if (specialistId && specialistId !== selectedBooking.specialistId) {
            return selectedBookingSpecialistMismatchResult(selectedBooking);
          }
          specialistId = selectedBooking.specialistId;
          specialistName = selectedBooking.specialistName ?? specialistName;
        }
      }

      if (needsNewBookingDate(ctx, serviceId || undefined, serviceName)) {
        return pendingBookingDateResult();
      }

      if (!specialistId && !specialistName && !serviceId && !serviceName) {
        return {
          result: JSON.stringify({
            error:
              'service_id or service_name, plus date_from and date_to, are required; use search_next_available only when the visitor asks for other available dates',
          }),
        };
      }

      const agent = await prisma.agent.findUnique({
        where: { id: ctx.agentId },
        select: { tenantId: true },
      });
      if (!agent) return { result: JSON.stringify({ error: 'Agent not found' }) };

      const timeZone = await getBusinessTimezone(ctx.agentId);
      const now = new Date();
      if (searchNextAvailable) {
        const tomorrow = addDaysToDateKey(getZonedDateTimeParts(now, timeZone).dateKey, 1);
        dateFrom = tomorrow;
        dateTo = addDaysToDateKey(tomorrow, 13);
      }
      const relativeDateText = [ctx.visitorText, args['relative_date']].filter(Boolean).join(' ');
      const relativeRange = searchNextAvailable
        ? null
        : resolveRelativeBookingDateRange(relativeDateText, now, timeZone);
      if (relativeRange) {
        dateFrom = relativeRange.dateFrom;
        dateTo = relativeRange.dateTo;
      }
      if (!dateFrom || !dateTo) {
        return {
          result: JSON.stringify({
            error:
              'date_from and date_to are required unless the visitor asks for a supported relative date or other available dates',
          }),
        };
      }

      const specialistWhere = {
        tenantId: agent.tenantId,
        isActive: true,
        OR: [{ agentId: null }, { agentId: ctx.agentId }],
      };
      let specialist = specialistId
        ? await prisma.specialist.findFirst({
            where: { id: specialistId, ...specialistWhere },
            select: { id: true, name: true, role: true },
          })
        : null;

      if (!specialist && specialistName) {
        const candidates = await prisma.specialist.findMany({
          where: specialistWhere,
          select: { id: true, name: true, role: true },
          orderBy: { name: 'asc' },
        });
        const matches = matchSpecialistsByName(
          specialistName,
          candidates.map((candidate) => ({
            ...candidate,
            matchingHints: buildSpecialistMatchingHints(candidate.name),
          })),
        );
        if (matches.length > 1) {
          return {
            result: JSON.stringify({
              error: 'SPECIALIST_AMBIGUOUS',
              instruction: 'Ask the visitor which specialist they mean.',
              candidates: matches.map(({ id, name, role }) => ({ id, name, role })),
            }),
          };
        }
        specialist = matches[0] ?? null;
        specialistId = specialist?.id ?? '';
      }
      if (!specialist && !specialistId && !specialistName) {
        const candidates = await prisma.specialist.findMany({
          where: specialistWhere,
          select: { id: true, name: true, role: true },
          orderBy: { name: 'asc' },
        });
        const serviceLookup = normalizeBookingLookup(serviceName || serviceId);
        const availability = await Promise.all(
          candidates.map(async (candidate) => {
            const services = await getActiveServicesForSpecialist({
              tenantId: agent.tenantId,
              specialistId: candidate.id,
            });
            const service = services.find((item) => {
              const normalizedName = normalizeBookingLookup(item.name);
              return (
                item.id === serviceId ||
                normalizedName === serviceLookup ||
                normalizedName.includes(serviceLookup)
              );
            });
            if (!service) return null;
            const slots = await findAvailableSlots(
              candidate.id,
              service.id,
              dateFrom,
              dateTo,
              timeZone,
            );
            return { candidate, service, slots };
          }),
        );
        const matches = availability.filter(
          (entry): entry is NonNullable<typeof entry> => entry !== null,
        );
        if (matches.length === 0) {
          return {
            result: JSON.stringify({
              error: 'SERVICE_NOT_FOUND',
              serviceName: serviceName || undefined,
              instruction:
                'Tell the visitor that this service is unavailable and offer to check another service.',
            }),
          };
        }
        let remainingSlots = 8;
        const specialists = matches
          .map(({ candidate, service, slots }) => {
            const formattedSlots = slots
              .slice(0, remainingSlots)
              .map((slot) => formatAvailableSlotForBusinessTime(slot, timeZone));
            remainingSlots -= formattedSlots.length;
            return {
              specialist: candidate,
              service: {
                id: service.id,
                name: service.name,
                isGroup: service.isGroup,
                capacity: service.capacity,
              },
              slots: formattedSlots,
            };
          })
          .filter((entry) => entry.slots.length > 0);
        if (specialists.length === 0) {
          return {
            result: JSON.stringify({
              error: 'NO_SLOTS',
              timeZone,
              dateRange: { dateFrom, dateTo, kind: 'explicit' },
              instruction:
                'Tell the visitor there are no free slots for this service on this date and offer another day.',
            }),
          };
        }
        const slotsForReplies = specialists.flatMap((entry) => entry.slots);
        return {
          result: JSON.stringify({
            timeZone,
            dateRange: { dateFrom, dateTo, kind: 'explicit' },
            instruction:
              'Show only specialists with returned slots, grouped by specialist. Ask the visitor to choose a specialist and exact local time. Do not claim a slot is unavailable unless it is absent from these results.',
            specialists: specialists.filter((entry) => entry.slots.length > 0),
          }),
          quickReplies: buildSlotQuickReplies(slotsForReplies),
        };
      }
      if (!specialist) {
        return {
          result: JSON.stringify({
            error: 'SPECIALIST_NOT_FOUND',
            specialistName: specialistName || undefined,
            instruction: 'Ask the visitor to choose from list_specialists.',
          }),
        };
      }

      if (!serviceId && serviceName) {
        const serviceLookup = normalizeBookingLookup(serviceName);
        const services = await getActiveServicesForSpecialist({
          tenantId: agent.tenantId,
          specialistId,
        });
        const matches = services.filter((service) => {
          const normalizedName = normalizeBookingLookup(service.name);
          return normalizedName === serviceLookup || normalizedName.includes(serviceLookup);
        });
        if (matches.length === 1) {
          serviceId = matches[0]!.id;
          serviceName = matches[0]!.name;
        } else if (matches.length > 1) {
          return {
            result: JSON.stringify({
              error: 'SERVICE_AMBIGUOUS',
              specialist: { id: specialist.id, name: specialist.name, role: specialist.role },
              services: matches.map(({ id, name, durationMin, priceLabel }) => ({
                id,
                name,
                durationMin,
                priceLabel,
              })),
              instruction: 'Ask the visitor to choose one exact service before checking slots.',
            }),
          };
        }
      }

      if (!serviceId) {
        const services = (
          await getActiveServicesForSpecialist({
            tenantId: agent.tenantId,
            specialistId,
          })
        ).map(({ id, name, durationMin, priceLabel }) => ({
          id,
          name,
          durationMin,
          priceLabel,
        }));
        return {
          result: JSON.stringify({
            error: 'SERVICE_REQUIRED',
            specialist: { id: specialist.id, name: specialist.name, role: specialist.role },
            services,
            instruction:
              'The specialist was found. Ask the visitor to choose a service before checking slots.',
          }),
        };
      }

      const bookableService = await getBookableServiceForSpecialist({
        tenantId: agent.tenantId,
        specialistId,
        serviceId,
      });
      if (!bookableService) {
        const services = (
          await getActiveServicesForSpecialist({
            tenantId: agent.tenantId,
            specialistId,
          })
        ).map(({ id, name, durationMin, priceLabel }) => ({
          id,
          name,
          durationMin,
          priceLabel,
        }));
        return {
          result: JSON.stringify({
            error: 'SERVICE_REQUIRED',
            specialist: { id: specialist.id, name: specialist.name, role: specialist.role },
            services,
            instruction:
              'The selected service does not belong to this specialist. Ask the visitor to choose one of the listed services.',
          }),
        };
      }

      const from = new Date(dateFrom);
      let to = new Date(dateTo);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return { result: JSON.stringify({ error: 'Invalid date range' }) };
      }
      const maxTo = new Date(from);
      maxTo.setDate(maxTo.getDate() + 14);
      if (to > maxTo) to = maxTo;
      to.setHours(23, 59, 59, 999);

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
      const formattedSlots = slots
        .slice(0, 20)
        .map((slot) => formatAvailableSlotForBusinessTime(slot, timeZone));

      if (formattedSlots.length === 0) {
        return {
          result: JSON.stringify({
            error: 'NO_SLOTS',
            timeZone,
            dateRange: { dateFrom, dateTo, kind: relativeRange?.kind ?? 'explicit' },
            specialist: { id: specialist.id, name: specialist.name, role: specialist.role },
            service: { id: bookableService.id, name: bookableService.name },
            instruction: searchNextAvailable
              ? 'There are no free slots for this specialist and service in the next 14 calendar days. Say that clearly without guessing why, then offer another specialist or a later date.'
              : 'There are no free slots for this specialist and service in the requested date range. Say that clearly without guessing why. Offer to check other dates for the same specialist or another specialist; do not ask the visitor to confirm the already selected service.',
          }),
          quickReplies: ['Другой день', 'Другой специалист'],
        };
      }

      return {
        result: JSON.stringify({
          timeZone,
          dateRange: { dateFrom, dateTo, kind: relativeRange?.kind ?? 'explicit' },
          specialist: { id: specialist.id, name: specialist.name, role: specialist.role },
          service: {
            id: bookableService.id,
            name: bookableService.name,
            isGroup: bookableService.isGroup,
            capacity: bookableService.capacity,
          },
          instruction: bookableService.isGroup
            ? 'Every returned group slot is available for booking. remainingSeats is the number of seats left in that exact group slot. When the visitor picks a group slot, ask whether they are booking only themselves or several people before calling create_appointment_request. If requested participants exceed remainingSeats, do not create the appointment; explain how many seats remain and offer another time. Do not require a separately pre-created group session; backend capacity checks are authoritative.'
            : 'These slots are already converted to local business time. Show display/local times to the visitor. Use bookingValue as starts_at when creating an appointment.',
          slots: formattedSlots,
        }),
        quickReplies: buildSlotQuickReplies(formattedSlots),
      };
    }

    case 'create_appointment_request': {
      let specialistId = String(args['specialist_id'] ?? '').trim();
      let specialistName = String(args['specialist_name'] ?? '').trim();
      let serviceId = args['service_id'] ? String(args['service_id']).trim() : undefined;
      let serviceName = String(args['service_name'] ?? '').trim();
      const startsAtStr = String(args['starts_at'] ?? '');
      const name = String(args['name'] ?? '').trim();
      const phone = String(args['phone'] ?? '').trim();
      const email = args['email'] ? String(args['email']).trim() : undefined;
      const savedGroupParticipants = ctx.bookingContext?.groupParticipants;
      const hasGroupParticipants =
        args['group_participants'] !== undefined || savedGroupParticipants !== undefined;
      const requestedParticipantsRaw = Number(
        args['group_participants'] ?? savedGroupParticipants ?? 1,
      );
      const requestedParticipants = Number.isInteger(requestedParticipantsRaw)
        ? requestedParticipantsRaw
        : 1;
      const selectedBooking = ctx.bookingContext;

      if (selectedBooking) {
        const suppliedDifferentService =
          (serviceId && serviceId !== selectedBooking.serviceId) ||
          (serviceName &&
            normalizeBookingLookup(serviceName) !==
              normalizeBookingLookup(selectedBooking.serviceName));
        if (suppliedDifferentService) return selectedBookingServiceMismatchResult(selectedBooking);

        serviceId = selectedBooking.serviceId;
        serviceName = selectedBooking.serviceName;

        if (selectedBooking.specialistId) {
          if (specialistId && specialistId !== selectedBooking.specialistId) {
            return selectedBookingSpecialistMismatchResult(selectedBooking);
          }
          specialistId = selectedBooking.specialistId;
          specialistName = selectedBooking.specialistName ?? specialistName;
        }
      }

      if (needsNewBookingDate(ctx, serviceId, serviceName)) {
        return pendingBookingDateResult();
      }
      if (
        ctx.visitorText &&
        !hasExplicitBookingDateTime(ctx.visitorText) &&
        !ctx.bookingContext?.selectedSlot
      ) {
        return bookingSelectionRequiredResult();
      }
      if (!matchesSelectedSlotTime(ctx, startsAtStr)) {
        return selectedSlotMismatchResult();
      }

      // Validate inputs
      if (!specialistId && !specialistName)
        return {
          result: JSON.stringify({
            success: false,
            error: 'specialist_id or specialist_name required',
            instruction:
              'Ask the visitor to choose a specialist, or call list_specialists/find_available_slots before creating the appointment.',
          }),
        };
      if (!startsAtStr)
        return { result: JSON.stringify({ success: false, error: 'starts_at required' }) };
      if (!serviceId && !serviceName)
        return {
          result: JSON.stringify({
            success: false,
            error: 'service_id or service_name required',
            instruction:
              'Ask the visitor to choose a service before creating the appointment. Do not create an appointment without a service.',
          }),
        };
      if (requestedParticipants < 1 || requestedParticipants > 20)
        return {
          result: JSON.stringify({
            success: false,
            error: 'group_participants must be between 1 and 20',
          }),
        };
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

      const specialistWhere = {
        tenantId: agent.tenantId,
        isActive: true,
        OR: [{ agentId: null }, { agentId: ctx.agentId }],
      };
      let specialist = specialistId
        ? await prisma.specialist.findFirst({
            where: {
              id: specialistId,
              ...specialistWhere,
            },
          })
        : null;
      if (!specialist) {
        const specialistLookup = specialistName || specialistId;
        const candidates = await prisma.specialist.findMany({
          where: specialistWhere,
          select: { id: true, name: true, role: true },
          orderBy: { name: 'asc' },
        });
        const matches = matchSpecialistsByName(
          specialistLookup,
          candidates.map((candidate) => ({
            ...candidate,
            matchingHints: buildSpecialistMatchingHints(candidate.name),
          })),
        );
        if (matches.length > 1) {
          return {
            result: JSON.stringify({
              success: false,
              error: 'SPECIALIST_AMBIGUOUS',
              instruction:
                'Ask the visitor which specialist they mean. Do not say the selected slot is booked unless appointment creation succeeds.',
              candidates: matches.map(({ id, name, role }) => ({ id, name, role })),
            }),
          };
        }
        specialist = matches[0]
          ? await prisma.specialist.findFirst({
              where: { id: matches[0].id, ...specialistWhere },
            })
          : null;
        specialistId = specialist?.id ?? '';
      }
      if (!specialist)
        return {
          result: JSON.stringify({
            success: false,
            error: 'Specialist not found',
            instruction:
              'Ask the visitor to choose a specialist from list_specialists. Do not say the selected slot is booked unless appointment creation succeeds.',
          }),
        };

      let bookableService = serviceId
        ? await getBookableServiceForSpecialist({
            tenantId: agent.tenantId,
            specialistId,
            serviceId,
          })
        : null;
      if (!bookableService && (serviceName || serviceId)) {
        const serviceLookup = normalizeBookingLookup(serviceName || serviceId || '');
        const services = await getActiveServicesForSpecialist({
          tenantId: agent.tenantId,
          specialistId,
        });
        const matches = services.filter((service) => {
          const normalizedName = normalizeBookingLookup(service.name);
          return normalizedName === serviceLookup || normalizedName.includes(serviceLookup);
        });
        if (matches.length === 1) {
          serviceId = matches[0]!.id;
          bookableService = {
            id: matches[0]!.id,
            durationMin: matches[0]!.durationMin,
            isGroup: matches[0]!.isGroup,
            capacity: matches[0]!.capacity,
          };
        }
      }
      if (!bookableService) {
        return {
          result: JSON.stringify({
            success: false,
            error: 'Service not found for this specialist',
            instruction:
              "Ask the visitor to choose one of this specialist's services. Do not say the selected slot is booked unless appointment creation succeeds.",
          }),
        };
      }
      if (bookableService.isGroup && !hasGroupParticipants) {
        return {
          result: JSON.stringify({
            success: false,
            error: 'group_participants required for group services',
            instruction:
              'Ask whether the visitor is booking only themselves or several people, then call create_appointment_request again with group_participants.',
          }),
        };
      }
      if (!bookableService.isGroup && requestedParticipants !== 1) {
        return {
          result: JSON.stringify({
            success: false,
            error: 'group_participants can only be used for group services',
            instruction: 'For individual services, create one appointment for one visitor.',
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

      // Race-condition safe slot check + create/update in transaction
      const participantNotes = bookableService.isGroup
        ? `Group participants: ${requestedParticipants}`
        : null;
      const appointment = await prisma
        .$transaction(async (tx) => {
          const existingGroupAppointment = bookableService.isGroup
            ? await tx.appointment.findFirst({
                where: {
                  tenantId: agent.tenantId,
                  specialistId,
                  serviceId: bookableService.id,
                  startsAt,
                  endsAt,
                  status: { in: ['PENDING', 'CONFIRMED'] },
                  OR: [{ sessionId: ctx.sessionId }, { visitorPhone: phone }],
                },
                select: { id: true },
              })
            : null;

          await assertSlotCanAcceptAppointment({
            specialistId,
            serviceId: bookableService.id,
            startsAt,
            endsAt,
            isGroup: bookableService.isGroup,
            capacity: bookableService.capacity,
            requestedParticipants: bookableService.isGroup ? requestedParticipants : 1,
            ...(existingGroupAppointment
              ? { excludeAppointmentId: existingGroupAppointment.id }
              : {}),
            db: tx,
          });

          if (existingGroupAppointment) {
            return tx.appointment.update({
              where: { id: existingGroupAppointment.id },
              data: {
                visitorName: name,
                visitorPhone: phone,
                visitorEmail: email ?? null,
                notes: participantNotes,
                status: 'PENDING',
              },
            });
          }

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
              notes: participantNotes,
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
                ? 'There are not enough free seats in this group session. Please choose another time or reduce the number of participants.'
                : 'That time slot is no longer available. Please choose another slot.',
            instruction:
              appointment === 'SLOT_FULL'
                ? 'Tell the visitor this slot does not have enough remaining seats for their requested group size and offer another returned slot.'
                : undefined,
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
            serviceName: bookableService.name ?? serviceName ?? bookableService.id,
            participants: bookableService.isGroup ? requestedParticipants : 1,
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
          message: bookableService.isGroup
            ? `Group appointment booked for ${requestedParticipants} participant${requestedParticipants === 1 ? '' : 's'} for ${name} on ${formatBusinessDateTime(startsAt, timeZone)} (${timeZone}). Service: ${bookableService.name ?? serviceName}. Status: PENDING — awaiting operator confirmation.`
            : `Appointment booked for ${name} on ${formatBusinessDateTime(startsAt, timeZone)} (${timeZone}). Service: ${bookableService.name ?? serviceName}. Status: PENDING — awaiting operator confirmation.`,
        }),
      };
    }

    default:
      return { result: JSON.stringify({ error: `Unknown tool: ${toolName}` }) };
  }
}
