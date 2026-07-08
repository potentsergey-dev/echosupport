import { describe, expect, it } from 'vitest';
import { isAdminOriginAllowed, isOriginAllowed } from '../services/origin-policy.js';

describe('origin policy', () => {
  it('supports unrestricted and explicit widget origins', () => {
    expect(isOriginAllowed('https://site.example', [])).toBe(true);
    expect(isOriginAllowed('https://site.example', ['https://site.example'])).toBe(true);
    expect(isOriginAllowed('https://site.example', ['https://site.example/'])).toBe(true);
    expect(isOriginAllowed('https://site.example', [' https://site.example/help '])).toBe(true);
    expect(isOriginAllowed('http://localhost:5173', ['http://localhost:5173/demo.html'])).toBe(
      true,
    );
    expect(isOriginAllowed('https://evil.example', ['https://site.example'])).toBe(false);
    expect(isOriginAllowed(undefined, ['https://site.example'])).toBe(false);
  });

  it('allows non-browser admin clients but restricts browser origins', () => {
    expect(isAdminOriginAllowed(undefined, 'https://admin.example')).toBe(true);
    expect(isAdminOriginAllowed('https://admin.example', 'https://admin.example')).toBe(true);
    expect(isAdminOriginAllowed('https://admin.example', 'https://admin.example/')).toBe(true);
    expect(isAdminOriginAllowed('https://evil.example', 'https://admin.example')).toBe(false);
  });
});
