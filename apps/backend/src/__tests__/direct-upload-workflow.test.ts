import type { UploadIntent } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectUploadStorage } from '../contracts/direct-upload.js';
import { createDirectUploadWorkflow } from '../services/direct-upload-workflow.js';
import type { createUploadIntentService } from '../services/upload-intents.js';

const scope = { tenantId: 'tenant', agentId: 'agent', uploaderId: 'user' };
const source = {
  key: 'tenant/agent/uploads/intent',
  version: '123',
  sizeBytes: 4,
  contentType: 'text/plain',
};
const final = {
  key: 'tenant/agent/documents/document',
  version: '456',
  sizeBytes: 4,
  contentType: 'text/plain',
  promotionSource: { key: source.key, version: source.version },
};
const intent = {
  id: 'intent',
  tenantId: scope.tenantId,
  agentId: scope.agentId,
  uploaderId: scope.uploaderId,
  stagingKey: source.key,
  finalKey: final.key,
  sourceVersion: null,
  status: 'PROCESSING',
  leaseToken: 'token',
  sizeBytes: 4,
  mimeType: 'text/plain',
  expiresAt: new Date(Date.now() + 60_000),
} as UploadIntent;

const intentMethods = {
  create: vi.fn(),
  claimCompletion: vi.fn(),
  recordSource: vi.fn(),
  renewCompletion: vi.fn(),
  complete: vi.fn(),
};
const storageMethods = {
  prepareUpload: vi.fn(),
  inspectUpload: vi.fn(),
  promoteUpload: vi.fn(),
  readObject: vi.fn(),
  deleteObject: vi.fn(),
};
const inspectContent = vi.fn();
const workflow = createDirectUploadWorkflow(
  intentMethods as unknown as ReturnType<typeof createUploadIntentService>,
  storageMethods as unknown as DirectUploadStorage,
  inspectContent,
);

describe('direct upload workflow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    intentMethods.claimCompletion.mockResolvedValue(intent);
    intentMethods.recordSource.mockResolvedValue({ ...intent, sourceVersion: source.version });
    intentMethods.renewCompletion.mockResolvedValue(intent);
    intentMethods.complete.mockResolvedValue({ id: 'document' });
    storageMethods.inspectUpload.mockImplementation(async (key: string) =>
      key === source.key ? source : null,
    );
    storageMethods.readObject.mockResolvedValue(Buffer.from('file'));
    storageMethods.promoteUpload.mockResolvedValue(final);
    inspectContent.mockResolvedValue(undefined);
  });

  it('issues a grant only for a live pending intent with its persisted expiry', async () => {
    const pending = { ...intent, status: 'PENDING' };
    intentMethods.create.mockResolvedValue(pending);
    storageMethods.prepareUpload.mockResolvedValue({
      url: 'https://storage.example',
      method: 'POST',
      headers: {},
      fields: { policy: 'signed' },
      expiresAt: pending.expiresAt,
    });
    const input = {
      idempotencyKey: 'once',
      filename: 'file.txt',
      mimeType: 'text/plain',
      sizeBytes: 4,
      expiresAt: pending.expiresAt,
    };

    await expect(workflow.issue(scope, input)).resolves.toMatchObject({ intentId: 'intent' });
    expect(storageMethods.prepareUpload).toHaveBeenCalledWith(
      { key: source.key, sizeBytes: 4, contentType: 'text/plain' },
      pending.expiresAt,
    );
    intentMethods.create.mockResolvedValueOnce(intent);
    await expect(workflow.issue(scope, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(storageMethods.prepareUpload).toHaveBeenCalledTimes(1);
  });

  it('inspects bytes before pinning source and only completes a provenance-matched copy', async () => {
    await expect(workflow.complete(scope, intent.id)).resolves.toMatchObject({ id: 'document' });

    expect(storageMethods.readObject).toHaveBeenCalledWith({
      key: source.key,
      version: source.version,
    });
    expect(inspectContent).toHaveBeenCalledWith(Buffer.from('file'), intent);
    expect(intentMethods.recordSource).toHaveBeenCalledWith(scope, intent.id, 'token', source);
    expect(storageMethods.promoteUpload).toHaveBeenCalledWith(
      { key: source.key, version: source.version },
      final.key,
    );
    expect(intentMethods.renewCompletion).toHaveBeenCalledWith(scope, intent.id, 'token');
    expect(intentMethods.complete).toHaveBeenCalledWith(scope, intent.id, 'token', final);
    expect(inspectContent.mock.invocationCallOrder[0]).toBeLessThan(
      intentMethods.recordSource.mock.invocationCallOrder[0]!,
    );
  });

  it('does not pin or promote an object rejected by content inspection', async () => {
    inspectContent.mockRejectedValueOnce(new Error('Unsupported content'));
    await expect(workflow.complete(scope, intent.id)).rejects.toThrow('Unsupported content');
    expect(intentMethods.recordSource).not.toHaveBeenCalled();
    expect(storageMethods.promoteUpload).not.toHaveBeenCalled();
    expect(intentMethods.complete).not.toHaveBeenCalled();
  });

  it('recovers a prior promotion without recopying or rereading staging bytes', async () => {
    intentMethods.claimCompletion.mockResolvedValueOnce({
      ...intent,
      sourceVersion: source.version,
    });
    storageMethods.inspectUpload.mockResolvedValueOnce(final);

    await expect(workflow.complete(scope, intent.id)).resolves.toMatchObject({ id: 'document' });
    expect(storageMethods.promoteUpload).not.toHaveBeenCalled();
    expect(storageMethods.readObject).not.toHaveBeenCalled();
    expect(intentMethods.complete).toHaveBeenCalledWith(scope, intent.id, 'token', final);
  });

  it('recovers a successful copy whose acknowledgement was lost', async () => {
    let finalReads = 0;
    intentMethods.claimCompletion.mockResolvedValueOnce({
      ...intent,
      sourceVersion: source.version,
    });
    storageMethods.inspectUpload.mockImplementation(async (key: string) => {
      if (key === source.key) return source;
      finalReads++;
      return finalReads === 1 ? null : final;
    });
    storageMethods.promoteUpload.mockRejectedValueOnce(new Error('Acknowledgement lost'));

    await expect(workflow.complete(scope, intent.id)).resolves.toMatchObject({ id: 'document' });
    expect(storageMethods.promoteUpload).toHaveBeenCalledTimes(1);
    expect(intentMethods.complete).toHaveBeenCalledWith(scope, intent.id, 'token', final);
  });

  it('rejects an occupied destination with unrelated provenance', async () => {
    intentMethods.claimCompletion.mockResolvedValueOnce({
      ...intent,
      sourceVersion: source.version,
    });
    storageMethods.inspectUpload.mockResolvedValueOnce({
      ...final,
      promotionSource: { key: 'other', version: source.version },
    });

    await expect(workflow.complete(scope, intent.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(storageMethods.promoteUpload).not.toHaveBeenCalled();
    expect(intentMethods.complete).not.toHaveBeenCalled();
  });

  it('rejects a changed source after a version was pinned', async () => {
    intentMethods.claimCompletion.mockResolvedValueOnce({
      ...intent,
      sourceVersion: source.version,
    });
    storageMethods.inspectUpload.mockImplementation(async (key: string) =>
      key === source.key ? { ...source, version: 'new' } : null,
    );

    await expect(workflow.complete(scope, intent.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(storageMethods.promoteUpload).not.toHaveBeenCalled();
    expect(intentMethods.complete).not.toHaveBeenCalled();
  });

  it('rejects a source changed between content inspection and promotion', async () => {
    let sourceReads = 0;
    storageMethods.inspectUpload.mockImplementation(async (key: string) => {
      if (key !== source.key) return null;
      sourceReads++;
      return sourceReads === 1 ? source : { ...source, version: 'new' };
    });

    await expect(workflow.complete(scope, intent.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(intentMethods.recordSource).toHaveBeenCalledTimes(1);
    expect(storageMethods.promoteUpload).not.toHaveBeenCalled();
    expect(intentMethods.complete).not.toHaveBeenCalled();
  });

  it('replays a completed intent against its verified final object', async () => {
    intentMethods.claimCompletion.mockResolvedValueOnce({
      ...intent,
      status: 'COMPLETED',
      sourceVersion: source.version,
      leaseToken: null,
    });
    storageMethods.inspectUpload.mockResolvedValueOnce(final);

    await expect(workflow.complete(scope, intent.id)).resolves.toMatchObject({ id: 'document' });
    expect(storageMethods.readObject).not.toHaveBeenCalled();
    expect(storageMethods.promoteUpload).not.toHaveBeenCalled();
    expect(intentMethods.renewCompletion).not.toHaveBeenCalled();
    expect(intentMethods.complete).toHaveBeenCalledWith(scope, intent.id, '', final);
  });
});
