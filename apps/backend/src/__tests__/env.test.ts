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
  describe('DB_POOL_MAX', () => {
    it('preserves the existing pool default', () => {
      expect(parseEnv(validEnv).DB_POOL_MAX).toBe(10);
    });

    it('accepts a bounded pool size', () => {
      expect(parseEnv({ ...validEnv, DB_POOL_MAX: '3' }).DB_POOL_MAX).toBe(3);
    });

    it.each(['0', '51', '1.5', 'invalid'])('rejects invalid pool size %s', (value) => {
      expect(() => parseEnv({ ...validEnv, DB_POOL_MAX: value })).toThrow();
    });
  });

  describe('trusted database TLS', () => {
    const ca = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';

    it('accepts a certificate and server name together', () => {
      const parsed = parseEnv({
        ...validEnv,
        DB_SSL_CA_PEM: ca,
        DB_SSL_SERVERNAME: 'db.internal',
      });
      expect(parsed.DB_SSL_CA_PEM).toBe(ca);
      expect(parsed.DB_SSL_SERVERNAME).toBe('db.internal');
    });

    it('rejects partial configuration and non-PEM input', () => {
      expect(() => parseEnv({ ...validEnv, DB_SSL_CA_PEM: ca })).toThrow();
      expect(() => parseEnv({ ...validEnv, DB_SSL_SERVERNAME: 'db.internal' })).toThrow();
      expect(() =>
        parseEnv({
          ...validEnv,
          DB_SSL_CA_PEM: 'invalid',
          DB_SSL_SERVERNAME: 'db.internal',
        }),
      ).toThrow();
    });
  });

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

  it('rejects temporary Cloud tenant plan mapping in production', () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        ENTITLEMENT_PROVIDER: 'cloud',
        CLOUD_TENANT_PLANS: 'tenant-a=PRO',
      }),
    ).toThrow(ZodError);
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
