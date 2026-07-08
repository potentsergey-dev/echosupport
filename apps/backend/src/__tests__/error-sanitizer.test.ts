import { describe, expect, it } from 'vitest';
import {
  redactSecrets,
  sanitizeErrorMessage,
  summarizeError,
} from '../services/error-sanitizer.js';

describe('error sanitizer', () => {
  it('redacts common secret shapes from persisted diagnostics', () => {
    const error = new Error(
      'failed for postgresql://user:super-secret@postgres:5432/app with Bearer sk-live-secret-token-123456789 and ?api_key=abc123',
    );

    const message = sanitizeErrorMessage(error);

    expect(message).toContain('Error: failed for postgresql://[redacted]@postgres:5432/app');
    expect(message).toContain('Bearer [redacted]');
    expect(message).toContain('api_key=[redacted]');
    expect(message).not.toContain('super-secret');
    expect(message).not.toContain('sk-live-secret-token');
    expect(message).not.toContain('abc123');
  });

  it('preserves useful error type and short safe message', () => {
    const summary = summarizeError(new TypeError('Qdrant request failed'));

    expect(summary).toEqual({ name: 'TypeError', message: 'Qdrant request failed' });
  });

  it('redacts public agent keys and long opaque tokens', () => {
    const redacted = redactSecrets(
      'agent pk_123456789abcdef token abcdef1234567890abcdef1234567890abcdef1234567890',
    );

    expect(redacted).toBe('agent [redacted-key] token [redacted-token]');
  });
});
