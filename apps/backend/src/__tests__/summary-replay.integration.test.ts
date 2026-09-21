import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../db/prisma.js';
import { chatCompletion } from '../adapters/llm/openrouter.js';
import { createPrismaJobDispatcher } from '../services/job-dispatcher.js';
import { summarizeIfNeeded, summarizeSession } from '../services/conversation-summarizer.js';

vi.mock('../adapters/llm/openrouter.js', () => ({ chatCompletion: vi.fn() }));
vi.mock('../services/agent-secrets.js', () => ({
  getAgentSecrets: vi.fn().mockResolvedValue({ openrouterKey: 'integration-test-key' }),
}));

const dispatcher = createPrismaJobDispatcher(prisma);
let tenantId: string;
let sessionId: string;
const keys: string[] = [];

describe('summary replay (PostgreSQL)', () => {
  beforeEach(async () => {
    vi.mocked(chatCompletion).mockReset();
    const tenant = await prisma.tenant.create({ data: { name: 'Summary replay test' } });
    tenantId = tenant.id;
    const agent = await prisma.agent.create({
      data: {
        tenantId,
        name: 'Summary agent',
        systemPrompt: 'Test',
        publicKey: randomUUID(),
      },
    });
    const session = await prisma.session.create({
      data: { agentId: agent.id, expiresAt: new Date(Date.now() + 60 * 60_000) },
    });
    sessionId = session.id;
    await prisma.message.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        sessionId,
        role: 'USER' as const,
        content: `Message ${index}`,
      })),
    });
  });

  afterEach(async () => {
    await prisma.job.deleteMany({
      where: { dedupeKey: { in: [...keys, `summarize-session:${sessionId}`] } },
    });
    keys.length = 0;
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('deduplicates concurrent enqueue and rejects changed parameters', async () => {
    const key = `summary-test:${randomUUID()}`;
    keys.push(key);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        dispatcher.enqueue('SUMMARIZE_SESSION', { sessionId }, { dedupeKey: key }),
      ),
    );
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(await prisma.job.count({ where: { dedupeKey: key } })).toBe(1);
    await expect(
      dispatcher.enqueue('SUMMARIZE_SESSION', { sessionId: 'different' }, { dedupeKey: key }),
    ).rejects.toThrow(/different parameters/);
  });

  it('schedules only one summary job and skips it after a summary exists', async () => {
    await Promise.all(Array.from({ length: 4 }, () => summarizeIfNeeded(sessionId)));
    expect(await prisma.job.count({ where: { dedupeKey: `summarize-session:${sessionId}` } })).toBe(
      1,
    );
    vi.mocked(chatCompletion).mockResolvedValue('First summary');
    await summarizeSession(sessionId);
    await summarizeSession(sessionId);
    await summarizeIfNeeded(sessionId);
    expect(vi.mocked(chatCompletion)).toHaveBeenCalledTimes(1);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).summary).toBe(
      'First summary',
    );
    expect(await prisma.job.count({ where: { dedupeKey: `summarize-session:${sessionId}` } })).toBe(
      1,
    );
  });

  it('does not let a slower duplicate overwrite the first committed summary', async () => {
    let releaseFirst!: (summary: string) => void;
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    vi.mocked(chatCompletion)
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseFirst = resolve;
            firstEntered();
          }),
      )
      .mockResolvedValueOnce('Newer result');

    const slow = summarizeSession(sessionId);
    await entered;
    await summarizeSession(sessionId);
    releaseFirst('Stale result');
    await slow;

    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).summary).toBe(
      'Newer result',
    );
  });
});
