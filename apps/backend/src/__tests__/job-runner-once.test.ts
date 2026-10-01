import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claimNext: vi.fn(),
  renew: vi.fn(),
  finish: vi.fn(),
  reindexAgent: vi.fn(),
}));

vi.mock('../db/prisma.js', () => ({ prisma: {} }));
vi.mock('../services/job-leases.js', () => ({
  createJobLeaseService: () => ({
    claimNext: mocks.claimNext,
    renew: mocks.renew,
    finish: mocks.finish,
  }),
}));
vi.mock('../services/indexer.js', () => ({ reindexAgent: mocks.reindexAgent }));
vi.mock('../services/conversation-summarizer.js', () => ({ summarizeSession: vi.fn() }));

import { runJobOnce } from '../services/job-runner.js';

const storage = {
  readFile: vi.fn(),
  readFileVersion: vi.fn(),
};

afterEach(() => {
  vi.resetAllMocks();
});

describe('one-shot job runner', () => {
  it('claims and completes only the requested job', async () => {
    mocks.claimNext.mockResolvedValue({
      job: { id: 'job-1', type: 'REINDEX_AGENT', payload: { agentId: 'agent-1' } },
      token: 'lease-1',
    });

    await runJobOnce('job-1', storage);

    expect(mocks.claimNext).toHaveBeenCalledWith('job-1');
    expect(mocks.reindexAgent).toHaveBeenCalledWith('agent-1', 'job-1', storage, 'lease-1');
    expect(mocks.finish).toHaveBeenCalledWith('job-1', 'lease-1', undefined);
  });

  it('fails when the requested job cannot be claimed', async () => {
    mocks.claimNext.mockResolvedValue(null);

    await expect(runJobOnce('job-1', storage)).rejects.toThrow('Job is not claimable');
    expect(mocks.claimNext).toHaveBeenCalledWith('job-1');
    expect(mocks.reindexAgent).not.toHaveBeenCalled();
  });

  it('marks a failed job and exits with an error', async () => {
    mocks.claimNext.mockResolvedValue({
      job: { id: 'job-1', type: 'REINDEX_AGENT', payload: { agentId: 'agent-1' } },
      token: 'lease-1',
    });
    mocks.reindexAgent.mockRejectedValue(new Error('Index failed'));

    await expect(runJobOnce('job-1', storage)).rejects.toThrow('Job failed');
    expect(mocks.finish).toHaveBeenCalledWith('job-1', 'lease-1', expect.any(String));
  });

  it('rejects an empty job ID before claiming anything', async () => {
    await expect(runJobOnce(' ', storage)).rejects.toThrow('JOB_ID is required');
    expect(mocks.claimNext).not.toHaveBeenCalled();
  });
});
