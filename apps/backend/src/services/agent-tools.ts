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
import { isBusinessHoursNow, getOutOfHoursMessage } from './business-hours.js';
import { publishToOperators } from './realtime-hub.js';
import { findAvailableSlots, isSlotWithinWorkingHours } from './slot-finder.js';
import { normalizeQuickReplies } from './quick-replies.js';
import { getBookableServiceForSpecialist } from './booking.js';

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
      description: 'Get the list of available specialists for booking at this clinic/business.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_services',
      description:
        'Get the list of services available for booking, optionally filtered by specialist.',
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
        'Find available appointment time slots for a specialist. Returns a list of free slots.',
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
            description: 'Start of the search window (ISO date string, e.g. "2026-06-01").',
          },
          date_to: {
            type: 'string',
            description: 'End of the search window (ISO date string, e.g. "2026-06-07").',
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
        'Create an appointment booking request. Only call after confirming all details with the visitor: name, phone, specialist, service, and time slot.',
      parameters: {
        type: 'object',
        properties: {
          specialist_id: { type: 'string', description: 'Specialist ID.' },
          service_id: { type: 'string', description: 'Service ID (optional).' },
          starts_at: { type: 'string', description: 'Appointment start time (ISO string).' },
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

      return { result: JSON.stringify({ specialists }) };
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

      const slots = await findAvailableSlots(specialistId, bookableService.id, from, to);

      // Return at most 20 slots to keep context manageable
      return { result: JSON.stringify({ slots: slots.slice(0, 20) }) };
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

      const startsAt = new Date(startsAtStr);
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
      const withinHours = await isSlotWithinWorkingHours(specialistId, startsAt, endsAt);
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
          // Lock check: find any conflicting appointment
          const conflict = await tx.appointment.findFirst({
            where: {
              specialistId,
              status: { notIn: ['CANCELLED'] },
              startsAt: { lt: endsAt },
              endsAt: { gt: startsAt },
            },
          });
          if (conflict) throw new Error('SLOT_TAKEN');

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
          if (err.message === 'SLOT_TAKEN') return null;
          throw err;
        });

      if (!appointment) {
        return {
          result: JSON.stringify({
            success: false,
            error: 'That time slot is no longer available. Please choose another slot.',
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
          message: `Appointment booked for ${name} on ${startsAt.toLocaleString('ru-RU')}. Status: PENDING — awaiting operator confirmation.`,
        }),
      };
    }

    default:
      return { result: JSON.stringify({ error: `Unknown tool: ${toolName}` }) };
  }
}
