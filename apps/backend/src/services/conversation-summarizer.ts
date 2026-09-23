import { prisma } from '../db/prisma.js';
import { getAgentSecrets } from './agent-secrets.js';
import { chatCompletion } from '../adapters/llm/openrouter.js';
import { env } from '../config/env.js';
import { prismaJobDispatcher } from './job-dispatcher.js';
import { createJobLeaseService } from './job-leases.js';

/** Trigger summarization when a session exceeds this many messages. */
const SUMMARIZE_THRESHOLD = 30;
const leases = createJobLeaseService(prisma);

interface SummaryJobLease {
  jobId: string;
  token: string;
}

/**
 * Schedules a SUMMARIZE_SESSION job if the session has grown beyond the threshold.
 * Safe to call fire-and-forget — catches and ignores errors internally.
 */
export async function summarizeIfNeeded(sessionId: string): Promise<void> {
  const count = await prisma.message.count({ where: { sessionId } });
  if (count < SUMMARIZE_THRESHOLD) return;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { summary: true },
  });
  if (!session || session.summary) return;
  await prismaJobDispatcher.enqueue(
    'SUMMARIZE_SESSION',
    { sessionId },
    { dedupeKey: `summarize-session:${sessionId}` },
  );
}

/**
 * Runs the summarization for a session (called by the job runner).
 * Summarises the oldest 20 messages and stores the result in session.summary.
 */
export async function summarizeSession(sessionId: string, lease?: SummaryJobLease): Promise<void> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 20 },
      agent: { select: { id: true, llmModel: true } },
    },
  });
  if (session.summary) return;

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
    const writeSummary = (db: Pick<typeof prisma, 'session'>) =>
      db.session.updateMany({
        where: { id: sessionId, summary: null },
        data: { summary },
      });
    if (lease) {
      await leases.withLease(lease.jobId, lease.token, writeSummary);
    } else {
      await writeSummary(prisma);
    }
  }
}
