import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({
  prisma: {
    job: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../services/indexer.js', () => ({
  reindexAgent: vi.fn(),
}));

vi.mock('../services/conversation-summarizer.js', () => ({
  summarizeSession: vi.fn(),
}));

import { prismaJobWorkerRunner } from '../services/job-runner.js';

describe('worker lifecycle', () => {
  it('starts and stops through the WorkerRunner contract', async () => {
    const handle = await prismaJobWorkerRunner.start();
    await expect(handle.stop()).resolves.toBeUndefined();
  });
});
