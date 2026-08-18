import { describe, expect, it, vi } from 'vitest';
import { clearAdminSession, getRole, getToken, setRole, setToken } from './auth';

describe('admin session cleanup', () => {
  it('clears token, role and query cache on logout', () => {
    const queryCache = { clear: vi.fn() };
    setToken('token-a');
    setRole('OWNER');

    clearAdminSession(queryCache);

    expect(getToken()).toBeNull();
    expect(getRole()).toBeNull();
    expect(queryCache.clear).toHaveBeenCalledTimes(1);
  });
});
