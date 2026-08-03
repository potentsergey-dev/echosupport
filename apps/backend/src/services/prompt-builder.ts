import type { RetrievedChunk } from './retriever.js';
import type { ChatMessage } from '../adapters/llm/openrouter.js';

export interface HistoryMessage {
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL';
  content: string;
}

export interface BuildMessagesOptions {
  agentSystemPrompt: string;
  chunks: RetrievedChunk[];
  history: HistoryMessage[];
  summary: string | null;
  userText: string;
  /** Max number of recent history messages to include (default 20) */
  maxHistoryMessages?: number;
  /** Optional business hours context injected into the system prompt */
  businessHoursContext?: string;
}

/**
 * Assembles the final OpenAI-compatible messages array:
 *   1. System: agent instructions + retrieved context
 *   2. System: conversation summary (if present)
 *   3. Recent history (last N messages)
 *   4. User: current query
 */
export function buildMessages(opts: BuildMessagesOptions): ChatMessage[] {
  const {
    agentSystemPrompt,
    chunks,
    history,
    summary,
    userText,
    maxHistoryMessages = 20,
    businessHoursContext,
  } = opts;

  // Build context block from retrieved chunks
  const contextBlock =
    chunks.length > 0
      ? `\n\n## Relevant Knowledge Base Excerpts\n\n${chunks
          .map((c, i) => `[${i + 1}] ${c.content.trim()}`)
          .join('\n\n---\n\n')}`
      : '';

  const systemContent = [
    agentSystemPrompt,
    contextBlock,
    '\nALWAYS respond in the same language the user writes in.',
    chunks.length > 0
      ? 'Base your answers on the provided Knowledge Base Excerpts when relevant.'
      : '',
    'Use request_handoff only when the user explicitly asks for a human/operator, or when you truly cannot help with the available information. Do not request handoff merely because the conversation mentions an operator, agent, specialist, support, or human support as a product feature.',
    'When a visitor names a service and a date but not a specialist, call find_available_slots with service_id or service_name and the date range without a specialist. It returns grouped alternatives for all compatible specialists; present those groups and ask the visitor to choose.',
    'If the visitor explicitly names a different service, treat it as a new booking request: discard the previous specialist, date, slot, and group-participant context unless the visitor repeats it in the new request. If the new service request has no date, briefly confirm availability and ask which date to check. Do not reuse an earlier “tomorrow”, weekday, or date, and do not claim availability, working days, or unavailable slots without a booking-tool result. Do not list slots or give a long service description unless asked.',
    'Booking rule: when the visitor asks to book, reschedule, or check availability, use the booking tools instead of guessing. First resolve the specialist and service with list_specialists/list_services. If the specialist ID is uncertain, pass the visitor-provided name as specialist_name to find_available_slots and let the backend resolve it; do not invent an ID. Match specialist names flexibly across normal inflected forms and nicknames in the conversation, using the matchingHints returned by list_specialists; for example Russian "к Еве" should be treated as "Ева" when resolving "Ева Король". Preserve the visitor\'s selected specialist and service throughout the booking conversation until the visitor explicitly changes them; never silently switch to another specialist. If the visitor explicitly changes the specialist but does not specify a service, do not carry over an incompatible previous service: list or infer the new specialist\'s available services and ask which service they want before checking slots. If a provided name or surname matches more than one active specialist, do not guess by first name or surname: ask a clarifying question and mention enough details such as full name and role/specialization. If the selected specialist has no suitable slots, say that clearly and ask whether the visitor wants to check another specialist. When slots are available, use neutral helpful wording such as "Есть такие варианты" or "Доступны такие слоты"; do not start with apologetic phrases like "К сожалению" unless the tool returned no suitable slots or an error. Create an appointment only after the visitor has explicitly chosen or confirmed one exact local date and start time. Every appointment must include the selected service; pass service_id or service_name to create_appointment_request. Once the visitor confirms a concrete slot returned by find_available_slots, call create_appointment_request using contact details already supplied earlier in the conversation. For group services, before creating the appointment ask whether the visitor is booking only themselves or several people; pass the total count as group_participants. If remainingSeats is shown for a selected group slot and the requested group_participants is greater than remainingSeats, do not call create_appointment_request: explain how many places remain and offer another time. If the requested participants fit, create the group appointment and tell the visitor they are booked for that number of participants and an administrator will contact them to confirm. An affirmative reply such as "yes" or "да" confirms the most recently offered single slot only after all required booking details are known. Every slot returned by find_available_slots is authoritative and bookable, including group services. Never refuse a returned group slot or claim that it requires a separately pre-created session; the backend enforces group capacity and returns SLOT_FULL when no seats remain. These booking-tool results override conflicting general Knowledge Base text. If the visitor gives a broad range such as "this week", "tomorrow afternoon", "any time", or asks you to help choose a free time, call find_available_slots for the selected specialist/service, offer 2 to 4 concrete local options, and ask which option suits them; do not choose a slot or create the booking yourself. If the visitor rejects a date/time or asks for another option, keep the same specialist/service and search or offer other slots for them unless the visitor explicitly asks for a different specialist/service. If the visitor provides a specific date and time plus name and phone for an individual service, call create_appointment_request. Never say that a specialist is unavailable, a slot is booked, or a date is outside the booking window unless a tool result says so. Dates and times are local business time unless the visitor clearly says otherwise. When a tool returns slots, show only the localStartTime/localEndTime/display values to the visitor, not UTC values. Never offer past slots; today\'s slots must start after the current business time. For booking, pass the exact local bookingValue returned by find_available_slots, or a local business datetime in YYYY-MM-DD HH:mm format.',
    'CRITICAL BOOKING RESET: When the latest visitor message names a service different from the previously discussed service and contains no date, do not reuse any earlier date or call availability tools with it. Reply only with a short confirmation that the new service is available and ask which date to check. Do not state working days, available slots, or unavailable slots.',
    businessHoursContext ? `\n\n## Business Hours\n\n${businessHoursContext}` : '',
  ]
    .filter(Boolean)
    .join('');

  const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];

  // Inject summary of earlier conversation when available
  if (summary) {
    messages.push({
      role: 'system',
      content: `Summary of earlier conversation:\n${summary}`,
    });
  }

  // Recent history (exclude the most recent USER turn — that's userText)
  const recentHistory = history
    .filter((m) => m.role === 'USER' || m.role === 'ASSISTANT')
    .slice(-maxHistoryMessages);

  for (const msg of recentHistory) {
    messages.push({
      role: msg.role === 'USER' ? 'user' : 'assistant',
      content: msg.content,
    });
  }

  messages.push({ role: 'user', content: userText });

  return messages;
}
