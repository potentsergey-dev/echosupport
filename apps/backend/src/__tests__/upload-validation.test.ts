import { describe, expect, it } from 'vitest';
import { validateUploadedObject } from '../services/upload-validation.js';

const expected = { key: 'staging/upload-1', sizeBytes: 42, contentType: 'text/plain' };
const actual = { ...expected, version: '9007199254740993' };

describe('uploaded object verification', () => {
  it('preserves the opaque version without numeric conversion or mutable aliasing', () => {
    const result = validateUploadedObject(expected, actual);
    expect(result).toEqual({ valid: true, object: actual });
    if (result.valid) expect(result.object).not.toBe(actual);
  });

  it('rejects an upload that has not arrived', () => {
    expect(validateUploadedObject(expected, null)).toEqual({
      valid: false,
      reason: 'MISSING_OBJECT',
    });
  });

  it.each([
    [{ key: 'other-tenant/object' }, 'KEY_MISMATCH'],
    [{ version: '' }, 'MISSING_VERSION'],
    [{ version: ' ' }, 'MISSING_VERSION'],
    [{ sizeBytes: 0 }, 'SIZE_MISMATCH'],
    [{ sizeBytes: 43 }, 'SIZE_MISMATCH'],
    [{ sizeBytes: 41 }, 'SIZE_MISMATCH'],
    [{ sizeBytes: NaN }, 'SIZE_MISMATCH'],
    [{ contentType: 'text/html' }, 'TYPE_MISMATCH'],
  ] as const)('rejects inconsistent provider metadata %j', (override, reason) => {
    expect(validateUploadedObject(expected, { ...actual, ...override })).toEqual({
      valid: false,
      reason,
    });
  });

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid declared size %s even when metadata matches',
    (sizeBytes) => {
      expect(validateUploadedObject({ ...expected, sizeBytes }, { ...actual, sizeBytes })).toEqual({
        valid: false,
        reason: 'INVALID_EXPECTATION',
      });
    },
  );

  it.each([{ key: '' }, { key: ' ' }, { contentType: '' }, { contentType: ' ' }])(
    'rejects empty intent identifiers %j',
    (override) => {
      expect(validateUploadedObject({ ...expected, ...override }, actual)).toEqual({
        valid: false,
        reason: 'INVALID_EXPECTATION',
      });
    },
  );
});
