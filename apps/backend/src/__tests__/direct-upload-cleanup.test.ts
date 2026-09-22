import type { UploadIntent } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectUploadStorage } from '../contracts/direct-upload.js';
import { createDirectUploadCleanup } from '../services/direct-upload-cleanup.js';
import { UploadIntentError, type createUploadIntentService } from '../services/upload-intents.js';

const intent = {
  id: 'intent',
  stagingKey: 'tenant/agent/uploads/intent',
  finalKey: 'tenant/agent/documents/document',
  sourceVersion: 'source-1',
  finalVersion: null,
  cleanupToken: 'cleanup-1',
} as UploadIntent;
const staging = {
  key: intent.stagingKey,
  version: 'source-2',
  sizeBytes: 4,
  contentType: 'text/plain',
};
const final = {
  key: intent.finalKey,
  version: 'final-1',
  sizeBytes: 4,
  contentType: 'text/plain',
  promotionSource: { key: intent.stagingKey, version: intent.sourceVersion! },
};
const prisma = { uploadIntent: { findMany: vi.fn() } };
const intents = { claimCleanup: vi.fn(), finishCleanup: vi.fn() };
const storage = { inspectUpload: vi.fn(), deleteObject: vi.fn() };
const cleanup = createDirectUploadCleanup(
  prisma as never,
  intents as unknown as ReturnType<typeof createUploadIntentService>,
  storage as unknown as DirectUploadStorage,
);

describe('direct upload cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.uploadIntent.findMany.mockResolvedValue([{ id: intent.id }]);
    intents.claimCleanup.mockResolvedValue({ intent, deleteFinalObject: true });
    storage.inspectUpload.mockImplementation(async (key: string) =>
      key === intent.stagingKey ? staging : final,
    );
    storage.deleteObject.mockResolvedValue(undefined);
    intents.finishCleanup.mockResolvedValue(intent);
  });

  it('deletes the current and pinned staging generations and a proven final generation', async () => {
    await expect(cleanup.run()).resolves.toBe(1);
    expect(storage.deleteObject.mock.calls).toEqual([
      [{ key: intent.stagingKey, version: staging.version }],
      [{ key: intent.stagingKey, version: intent.sourceVersion }],
      [{ key: intent.finalKey, version: final.version }],
    ]);
    expect(intents.finishCleanup).toHaveBeenCalledWith(intent.id, intent.cleanupToken);
  });

  it('preserves the final object while its document still exists', async () => {
    intents.claimCleanup.mockResolvedValueOnce({ intent, deleteFinalObject: false });
    await expect(cleanup.run()).resolves.toBe(1);
    expect(storage.inspectUpload).not.toHaveBeenCalledWith(intent.finalKey);
    expect(storage.deleteObject).not.toHaveBeenCalledWith({
      key: intent.finalKey,
      version: final.version,
    });
  });

  it('rejects an unrelated final object and leaves cleanup unfinished for retry', async () => {
    storage.inspectUpload.mockImplementation(async (key: string) =>
      key === intent.stagingKey
        ? staging
        : { ...final, promotionSource: { key: 'unrelated', version: intent.sourceVersion! } },
    );
    await expect(cleanup.run()).resolves.toBe(0);
    expect(storage.deleteObject).not.toHaveBeenCalledWith({
      key: intent.finalKey,
      version: final.version,
    });
    expect(intents.finishCleanup).not.toHaveBeenCalled();
  });

  it('does not delete an unrecorded final object', async () => {
    intents.claimCleanup.mockResolvedValueOnce({
      intent: { ...intent, sourceVersion: null },
      deleteFinalObject: true,
    });
    await expect(cleanup.run()).resolves.toBe(0);
    expect(storage.deleteObject).not.toHaveBeenCalledWith({
      key: intent.finalKey,
      version: final.version,
    });
    expect(intents.finishCleanup).not.toHaveBeenCalled();
  });

  it('rejects a changed final generation after completion', async () => {
    intents.claimCleanup.mockResolvedValueOnce({
      intent: { ...intent, finalVersion: 'recorded-final' },
      deleteFinalObject: true,
    });
    await expect(cleanup.run()).resolves.toBe(0);
    expect(storage.deleteObject).not.toHaveBeenCalledWith({
      key: intent.finalKey,
      version: final.version,
    });
    expect(intents.finishCleanup).not.toHaveBeenCalled();
  });

  it('deletes a recorded final generation even when it is no longer current', async () => {
    const completed = { ...intent, finalVersion: 'final-1' };
    intents.claimCleanup.mockResolvedValueOnce({ intent: completed, deleteFinalObject: true });
    storage.inspectUpload.mockImplementation(async (key: string) =>
      key === intent.stagingKey ? staging : null,
    );
    await expect(cleanup.run()).resolves.toBe(1);
    expect(storage.deleteObject).toHaveBeenCalledWith({
      key: intent.finalKey,
      version: 'final-1',
    });
  });

  it('does not finish cleanup when storage deletion fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.deleteObject.mockRejectedValueOnce(new Error('storage unavailable'));
    try {
      await expect(cleanup.run()).resolves.toBe(0);
      expect(intents.finishCleanup).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('skips a leased candidate without touching storage', async () => {
    intents.claimCleanup.mockRejectedValueOnce(new UploadIntentError('CONFLICT'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(cleanup.run()).resolves.toBe(0);
      expect(storage.inspectUpload).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('continues to the next candidate after a lease conflict', async () => {
    prisma.uploadIntent.findMany
      .mockResolvedValueOnce([{ id: 'leased' }, { id: intent.id }])
      .mockResolvedValueOnce([]);
    intents.claimCleanup.mockRejectedValueOnce(new UploadIntentError('CONFLICT'));
    await expect(cleanup.run(2)).resolves.toBe(1);
    expect(intents.claimCleanup).toHaveBeenCalledWith('leased');
    expect(intents.claimCleanup).toHaveBeenCalledWith(intent.id);
    expect(intents.finishCleanup).toHaveBeenCalledTimes(1);
  });
});
