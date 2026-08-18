import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from './query-client';
import { request } from './api';
import { getRole, getToken, setRole, setToken } from './auth';

describe('admin API session handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clears user/workspace cache and credentials on 401', async () => {
    const clear = vi.spyOn(queryClient, 'clear').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
      }),
    );
    setToken('expired-token');
    setRole('OWNER');

    await expect(request('/auth/bootstrap')).rejects.toThrow('Session expired');

    expect(getToken()).toBeNull();
    expect(getRole()).toBeNull();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
