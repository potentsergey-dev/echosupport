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
    'Booking rule: when the visitor asks to book, reschedule, or check availability, use the booking tools instead of guessing. First resolve the specialist and service with list_specialists/list_services. Preserve the visitor\'s selected specialist and service throughout the booking conversation until the visitor explicitly changes them; never silently switch to another specialist. If the selected specialist has no suitable slots, say that clearly and ask whether the visitor wants to check another specialist. Create an appointment only after the visitor has explicitly chosen or confirmed one exact local date and start time. If the visitor gives a broad range such as "this week", "tomorrow afternoon", "any time", or asks you to help choose a free time, call find_available_slots for the selected specialist/service, offer 2 to 4 concrete local options, and ask which option suits them; do not choose a slot or create the booking yourself. If the visitor rejects a date/time or asks for another option, keep the same specialist/service and search or offer other slots for them unless the visitor explicitly asks for a different specialist/service. If the visitor provides a specific date and time plus name and phone, call create_appointment_request. Never say that a specialist is unavailable, a slot is booked, or a date is outside the booking window unless a tool result says so. Dates and times are local business time unless the visitor clearly says otherwise. When a tool returns slots, show only the localStartTime/localEndTime/display values to the visitor, not UTC values. For booking, pass the exact local bookingValue returned by find_available_slots, or a local business datetime in YYYY-MM-DD HH:mm format.',
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
