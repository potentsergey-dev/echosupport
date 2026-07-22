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
