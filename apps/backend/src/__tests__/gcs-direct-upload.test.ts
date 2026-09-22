import { Storage } from '@google-cloud/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGcsDirectUploadStorage } from '../adapters/storage/gcs-direct-upload.js';

const generation = '90071992547409931234';
const metadata = {
  generation,
  size: '42',
  contentType: 'application/pdf',
};
const promotedMetadata = {
  ...metadata,
  metadata: { uploadSourceKey: 'staging', uploadSourceGeneration: generation },
};

const destination = {
  getMetadata: vi.fn().mockResolvedValue([promotedMetadata]),
};
const staging = {
  generateSignedPostPolicyV4: vi.fn().mockResolvedValue([
    {
      url: 'https://storage.googleapis.com/example/',
      fields: { key: 'staging', policy: 'signed' },
    },
  ]),
  getMetadata: vi.fn().mockResolvedValue([metadata]),
  copy: vi.fn().mockResolvedValue([destination]),
  download: vi.fn().mockResolvedValue([Buffer.from('file')]),
  delete: vi.fn().mockResolvedValue(undefined),
};
const bucket = {
  file: vi.fn().mockImplementation((key: string) => (key === 'staging' ? staging : destination)),
};
const storage = { bucket: vi.fn().mockReturnValue(bucket) } as unknown as Storage;

describe('GCS direct upload adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staging.getMetadata.mockResolvedValue([metadata]);
    destination.getMetadata.mockResolvedValue([promotedMetadata]);
  });

  it('signs an exact-size and exact-type POST policy for the staging key', async () => {
    const adapter = createGcsDirectUploadStorage('example', storage);
    const expiresAt = new Date(Date.now() + 60_000);
    const grant = await adapter.prepareUpload(
      { key: 'staging', sizeBytes: 42, contentType: 'application/pdf' },
      expiresAt,
    );

    expect(staging.generateSignedPostPolicyV4).toHaveBeenCalledWith({
      expires: expiresAt,
      fields: { 'Content-Type': 'application/pdf' },
      conditions: [['content-length-range', 42, 42]],
    });
    expect(grant).toEqual({
      url: 'https://storage.googleapis.com/example/',
      method: 'POST',
      headers: {},
      fields: { key: 'staging', policy: 'signed' },
      expiresAt,
    });
  });

  it('includes key, bucket, size and MIME constraints in the SDK policy', async () => {
    const sdk = new Storage({ projectId: 'test-project' });
    Object.defineProperty(sdk.authClient, 'getCredentials', {
      value: vi.fn().mockResolvedValue({
        client_email: 'signer@example.iam.gserviceaccount.com',
      }),
    });
    vi.spyOn(sdk.authClient, 'sign').mockResolvedValue(Buffer.from('signature').toString('base64'));
    const expiresAt = new Date(Date.now() + 60_000);
    const grant = await createGcsDirectUploadStorage('example', sdk).prepareUpload(
      { key: 'staging', sizeBytes: 42, contentType: 'application/pdf' },
      expiresAt,
    );
    const policy = JSON.parse(Buffer.from(grant.fields!['policy']!, 'base64').toString('utf8')) as {
      conditions: unknown[];
    };

    expect(policy.conditions).toContainEqual(['content-length-range', 42, 42]);
    expect(policy.conditions).toContainEqual({ 'Content-Type': 'application/pdf' });
    expect(policy.conditions).toContainEqual({ bucket: 'example' });
    expect(policy.conditions).toContainEqual({ key: 'staging' });
  });

  it('rejects invalid or unbounded grants before signing', async () => {
    const adapter = createGcsDirectUploadStorage('example', storage);
    await expect(
      adapter.prepareUpload(
        { key: '../other', sizeBytes: 42, contentType: 'application/pdf' },
        new Date(Date.now() + 60_000),
      ),
    ).rejects.toThrow('Invalid object key');
    await expect(
      adapter.prepareUpload(
        { key: 'staging', sizeBytes: 42, contentType: 'application/pdf' },
        new Date(Date.now() + 16 * 60_000),
      ),
    ).rejects.toThrow('Invalid direct upload grant');
    expect(staging.generateSignedPostPolicyV4).not.toHaveBeenCalled();
  });

  it('inspects authoritative metadata without rounding a large generation', async () => {
    const adapter = createGcsDirectUploadStorage('example', storage);
    await expect(adapter.inspectUpload('staging')).resolves.toEqual({
      key: 'staging',
      version: generation,
      sizeBytes: 42,
      contentType: 'application/pdf',
    });
    staging.getMetadata.mockRejectedValueOnce({ code: 404 });
    await expect(adapter.inspectUpload('staging')).resolves.toBeNull();
    staging.getMetadata.mockResolvedValueOnce([{ ...metadata, size: '9007199254740993' }]);
    await expect(adapter.inspectUpload('staging')).rejects.toThrow('Incomplete');
    staging.getMetadata.mockResolvedValueOnce([
      { ...metadata, generation: Number.MAX_SAFE_INTEGER + 1 },
    ]);
    await expect(adapter.inspectUpload('staging')).rejects.toThrow('Incomplete');
    destination.getMetadata.mockResolvedValueOnce([promotedMetadata]);
    await expect(adapter.inspectUpload('final')).resolves.toEqual({
      key: 'final',
      version: generation,
      sizeBytes: 42,
      contentType: 'application/pdf',
      promotionSource: { key: 'staging', version: generation },
    });
  });

  it('pins source generation and prevents destination overwrite on promotion', async () => {
    const adapter = createGcsDirectUploadStorage('example', storage);
    await expect(
      adapter.promoteUpload({ key: 'staging', version: generation }, 'final'),
    ).resolves.toEqual({
      key: 'final',
      version: generation,
      sizeBytes: 42,
      contentType: 'application/pdf',
      promotionSource: { key: 'staging', version: generation },
    });
    expect(bucket.file).toHaveBeenCalledWith('staging', { generation });
    expect(staging.copy).toHaveBeenCalledWith(destination, {
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { uploadSourceKey: 'staging', uploadSourceGeneration: generation },
    });
    staging.copy.mockRejectedValueOnce({ code: 412 });
    await expect(
      adapter.promoteUpload({ key: 'staging', version: generation }, 'final'),
    ).rejects.toMatchObject({ code: 412 });
    destination.getMetadata.mockResolvedValueOnce([metadata]);
    await expect(
      adapter.promoteUpload({ key: 'staging', version: generation }, 'final'),
    ).rejects.toThrow('provenance mismatch');
  });

  it('reads and deletes only the requested generation', async () => {
    const adapter = createGcsDirectUploadStorage('example', storage);
    await expect(adapter.readObject({ key: 'staging', version: generation })).resolves.toEqual(
      Buffer.from('file'),
    );
    await adapter.deleteObject({ key: 'staging', version: generation });
    expect(bucket.file).toHaveBeenCalledWith('staging', { generation });
    expect(staging.delete).toHaveBeenCalledWith({
      ignoreNotFound: true,
      ifGenerationMatch: generation,
    });
    staging.delete.mockRejectedValueOnce({ code: 412 });
    await expect(
      adapter.deleteObject({ key: 'staging', version: generation }),
    ).rejects.toMatchObject({ code: 412 });
  });
});
