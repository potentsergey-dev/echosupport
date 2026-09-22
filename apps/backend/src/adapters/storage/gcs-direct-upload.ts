import { Storage, type FileMetadata } from '@google-cloud/storage';
import type {
  DirectUploadStorage,
  UploadExpectation,
  UploadMetadata,
  UploadObject,
} from '../../contracts/direct-upload.js';

const MAX_GRANT_MS = 15 * 60_000;

function assertKey(key: string): void {
  if (!key.trim() || key.startsWith('/') || key.includes('\\') || key.includes('..')) {
    throw new Error('Invalid object key');
  }
}

function assertVersion(version: string): void {
  if (!/^[1-9]\d*$/.test(version)) throw new Error('Invalid object generation');
}

function toUploadMetadata(key: string, metadata: FileMetadata): UploadMetadata {
  const version =
    typeof metadata.generation === 'string'
      ? metadata.generation
      : Number.isSafeInteger(metadata.generation)
        ? String(metadata.generation)
        : '';
  const sizeBytes = Number(metadata.size);
  if (
    !/^[1-9]\d*$/.test(version) ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    !metadata.contentType
  ) {
    throw new Error('Incomplete Cloud Storage object metadata');
  }
  const sourceKey = metadata.metadata?.['uploadSourceKey'];
  const sourceVersion = metadata.metadata?.['uploadSourceGeneration'];
  if ((sourceKey == null) !== (sourceVersion == null)) {
    throw new Error('Incomplete Cloud Storage promotion provenance');
  }
  const promotionSource =
    typeof sourceKey === 'string' && typeof sourceVersion === 'string'
      ? { key: sourceKey, version: sourceVersion }
      : undefined;
  if (sourceKey != null && !promotionSource) {
    throw new Error('Invalid Cloud Storage promotion provenance');
  }
  return {
    key,
    version,
    sizeBytes,
    contentType: metadata.contentType,
    ...(promotionSource ? { promotionSource } : {}),
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 404;
}

export function createGcsDirectUploadStorage(
  bucketName: string,
  storage: Storage = new Storage(),
): DirectUploadStorage {
  if (!bucketName.trim()) throw new Error('Cloud Storage bucket is required');
  const bucket = storage.bucket(bucketName);

  return {
    async prepareUpload(expected: UploadExpectation, expiresAt: Date) {
      assertKey(expected.key);
      const lifetime = expiresAt.getTime() - Date.now();
      if (
        !Number.isSafeInteger(expected.sizeBytes) ||
        expected.sizeBytes <= 0 ||
        !expected.contentType.trim() ||
        !Number.isFinite(lifetime) ||
        lifetime <= 0 ||
        lifetime > MAX_GRANT_MS
      ) {
        throw new Error('Invalid direct upload grant');
      }
      const [policy] = await bucket.file(expected.key).generateSignedPostPolicyV4({
        expires: expiresAt,
        fields: { 'Content-Type': expected.contentType },
        conditions: [['content-length-range', expected.sizeBytes, expected.sizeBytes]],
      });
      return {
        url: policy.url,
        method: 'POST' as const,
        headers: {},
        fields: policy.fields,
        expiresAt,
      };
    },

    async inspectUpload(key: string) {
      assertKey(key);
      try {
        const [metadata] = await bucket.file(key).getMetadata();
        return toUploadMetadata(key, metadata);
      } catch (error: unknown) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async promoteUpload(source: UploadObject, destinationKey: string) {
      assertKey(source.key);
      assertKey(destinationKey);
      assertVersion(source.version);
      if (source.key === destinationKey) throw new Error('Source and destination must differ');
      const [destination] = await bucket
        .file(source.key, { generation: source.version })
        .copy(bucket.file(destinationKey), {
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            uploadSourceKey: source.key,
            uploadSourceGeneration: source.version,
          },
        });
      const [metadata] = await destination.getMetadata();
      const result = toUploadMetadata(destinationKey, metadata);
      if (
        result.promotionSource?.key !== source.key ||
        result.promotionSource.version !== source.version
      ) {
        throw new Error('Cloud Storage promotion provenance mismatch');
      }
      return result;
    },

    async readObject(object: UploadObject) {
      assertKey(object.key);
      assertVersion(object.version);
      const [buffer] = await bucket.file(object.key, { generation: object.version }).download();
      return buffer;
    },

    async deleteObject(object: UploadObject) {
      assertKey(object.key);
      assertVersion(object.version);
      await bucket.file(object.key, { generation: object.version }).delete({
        ignoreNotFound: true,
        ifGenerationMatch: object.version,
      });
    },
  };
}
