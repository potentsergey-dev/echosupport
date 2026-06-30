import { prisma } from '../db/prisma.js';
import { getAgentSecrets } from './agent-secrets.js';
import { chatCompletion } from '../adapters/llm/openrouter.js';
import { env } from '../config/env.js';

/** Trigger summarization when a session exceeds this many messages. */
const SUMMARIZE_THRESHOLD = 30;

/**
 * Schedules a SUMMARIZE_SESSION job if the session has grown beyond the threshold.
 * Safe to call fire-and-forget — catches and ignores errors internally.
 */
export async function summarizeIfNeeded(sessionId: string): Promise<void> {
  const count = await prisma.message.count({ where: { sessionId } });
  if (count < SUMMARIZE_THRESHOLD) return;

  // Avoid scheduling duplicate jobs
  const existing = await prisma.job.findFirst({
    where: {
      type: 'SUMMARIZE_SESSION',
      status: { in: ['PENDING', 'RUNNING'] },
      payload: { path: ['sessionId'], equals: sessionId },
    },
  });
  if (existing) return;

  await prisma.job.create({
    data: { type: 'SUMMARIZE_SESSION', payload: { sessionId } },
  });
}

/**
 * Runs the summarization for a session (called by the job runner).
 * Summarises the oldest 20 messages and stores the result in session.summary.
 */
export async function summarizeSession(sessionId: string): Promise<void> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 20 },
      agent: { select: { id: true, llmModel: true } },
    },
  });

  // Resolve LLM key: agent secret → global fallback
  let openrouterKey = env.OPENROUTER_API_KEY;
  try {
    const secrets = await getAgentSecrets(session.agent.id);
    if (secrets.openrouterKey) openrouterKey = secrets.openrouterKey;
  } catch {
    // No agent secrets configured
  }

  if (!openrouterKey) return; // Cannot summarize without a key

  const historyText = session.messages.map((m) => `${m.role}: ${m.content}`).join('\n');

  const summary = await chatCompletion(
    [
      {
        role: 'system',
        content:
          'Summarize the following customer support conversation in 2-3 sentences. ' +
          'Capture the main topics discussed and any resolutions reached. Be concise.',
      },
      { role: 'user', content: historyText },
    ],
    session.agent.llmModel,
    openrouterKey,
  );

  if (summary) {
    await prisma.session.update({ where: { id: sessionId }, data: { summary } });
  }
}
