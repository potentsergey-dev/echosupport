import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { formatEnvIssues, parseEnv } from '../config/env-validation.js';

const validEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/echosupport',
  JWT_SECRET: 'jwt-secret-at-least-32-random-characters',
  MASTER_ENCRYPTION_KEY: 'a'.repeat(64),
  ADMIN_CORS_ORIGINS: 'https://support.example,https://admin.example/',
  APP_URL: 'https://support.example',
  PUBLIC_BASE_URL: 'https://support.example',
  CRON_SECRET: 'cron-secret-at-least-32-random-characters',
};

describe('environment validation', () => {
  it('accepts explicit production configuration with normalized admin origins', () => {
    expect(parseEnv(validEnv)).toMatchObject({
      NODE_ENV: 'production',
      ADMIN_CORS_ORIGINS: validEnv.ADMIN_CORS_ORIGINS,
      MASTER_ENCRYPTION_KEY: validEnv.MASTER_ENCRYPTION_KEY,
    });
  });

  it('rejects copied example placeholders for runtime secrets', () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        JWT_SECRET: 'replace-with-at-least-32-random-characters',
        CRON_SECRET: 'change_me_to_a_long_random_string',
      }),
    ).toThrow(ZodError);
  });

  it('requires the encryption key to be exactly 64 hex characters', () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        MASTER_ENCRYPTION_KEY: 'z'.repeat(64),
      }),
    ).toThrow(/hexadecimal/);
  });

  it('rejects wildcard, empty, path-based, and malformed admin origins', () => {
    for (const ADMIN_CORS_ORIGINS of ['*', ' ', 'https://support.example/admin', 'not-a-url']) {
      expect(() => parseEnv({ ...validEnv, ADMIN_CORS_ORIGINS })).toThrow(ZodError);
    }
  });

  it('formats validation failures without dumping secret values', () => {
    const result = (() => {
      try {
        parseEnv({ ...validEnv, JWT_SECRET: 'short' });
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(result).toBeInstanceOf(ZodError);
    const lines = formatEnvIssues(result as ZodError);
    expect(lines.join('\n')).toContain('JWT_SECRET');
    expect(lines.join('\n')).not.toContain('short');
  });
});
