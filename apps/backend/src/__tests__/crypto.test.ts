import { vi, describe, it, expect } from 'vitest';

// Mock env before any module that reads it is imported
vi.mock('../config/env.js', () => ({
  env: {
    MASTER_ENCRYPTION_KEY: 'a'.repeat(64), // 64 hex chars → 32-byte key
    NODE_ENV: 'test' as const,
    PORT: 3000,
    HOST: '0.0.0.0',
    DATABASE_URL: 'postgresql://test',
    JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
    ADMIN_CORS_ORIGINS: 'http://localhost:5173',
    UPLOADS_DIR: './uploads',
    APP_URL: 'http://localhost:3000',
  },
}));

const { encrypt, decrypt } = await import('../services/crypto.js');

describe('crypto — AES-256-GCM', () => {
  it('encrypts a string and decrypts it back correctly', () => {
    const plaintext = 'sk-test-api-key-12345678';
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces different ciphertext for identical input (random IV)', () => {
    const plaintext = 'same-plaintext';
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  it('round-trips an empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('round-trips a unicode string', () => {
    const plaintext = 'Привет мир 🔐';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('throws on invalid ciphertext (wrong number of segments)', () => {
    expect(() => decrypt('onlyone')).toThrow();
    expect(() => decrypt('only:two')).toThrow();
    expect(() => decrypt('a:b:c:d')).toThrow();
  });

  it('throws when ciphertext has been tampered (auth tag mismatch)', () => {
    const ciphertext = encrypt('secret value');
    const parts = ciphertext.split(':');
    // Replace the data segment with zeros
    const tampered = `${parts[0]}:${parts[1]}:${'00'.repeat(16)}`;
    expect(() => decrypt(tampered)).toThrow();
  });
});
