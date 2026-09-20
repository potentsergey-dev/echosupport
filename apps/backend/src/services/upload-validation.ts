import type { UploadExpectation, UploadMetadata } from '../contracts/direct-upload.js';

export type UploadValidationFailure =
  | 'INVALID_EXPECTATION'
  | 'MISSING_OBJECT'
  | 'KEY_MISMATCH'
  | 'MISSING_VERSION'
  | 'SIZE_MISMATCH'
  | 'TYPE_MISMATCH';

export type UploadValidationResult =
  | { valid: true; object: UploadMetadata }
  | { valid: false; reason: UploadValidationFailure };

/** Metadata validation is not content inspection or an authorization check. */
export function validateUploadedObject(
  expected: UploadExpectation,
  actual: UploadMetadata | null,
): UploadValidationResult {
  if (
    !expected.key.trim() ||
    !expected.contentType.trim() ||
    !Number.isSafeInteger(expected.sizeBytes) ||
    expected.sizeBytes <= 0
  ) {
    return { valid: false, reason: 'INVALID_EXPECTATION' };
  }
  if (!actual) return { valid: false, reason: 'MISSING_OBJECT' };
  if (actual.key !== expected.key) return { valid: false, reason: 'KEY_MISMATCH' };
  if (!actual.version.trim()) return { valid: false, reason: 'MISSING_VERSION' };
  if (actual.sizeBytes !== expected.sizeBytes) {
    return { valid: false, reason: 'SIZE_MISMATCH' };
  }
  if (actual.contentType !== expected.contentType) {
    return { valid: false, reason: 'TYPE_MISMATCH' };
  }
  return { valid: true, object: { ...actual } };
}
