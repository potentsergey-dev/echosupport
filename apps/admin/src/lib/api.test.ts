import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from './query-client';
import {
  request,
  createAppointment,
  getPendingBookingRequestKey,
  clearPendingBookingRequestKey,
  findBookingRequest,
} from './api';
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

describe('booking request recovery', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });
  it('retains the operation key after a lost response and sends it on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network interrupted'))
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'same-booking' }) });
    vi.stubGlobal('fetch', fetchMock);
    const key = getPendingBookingRequestKey();
    const payload = {
      visitorName: 'Synthetic',
      visitorPhone: '+000000001',
      startsAt: '2099-12-01T09:00:00Z',
    };
    await expect(createAppointment(payload, key)).rejects.toThrow('Network interrupted');
    expect(getPendingBookingRequestKey()).toBe(key);
    await expect(createAppointment(payload, key)).resolves.toMatchObject({ id: 'same-booking' });
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).headers)).toEqual([
      expect.objectContaining({ 'Idempotency-Key': key }),
      expect.objectContaining({ 'Idempotency-Key': key }),
    ]);
    clearPendingBookingRequestKey(key);
    expect(getPendingBookingRequestKey()).not.toBe(key);
  });
  it('treats only an authorized 404 as absence, preserving uncertainty on errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ error: 'Appointment not found' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Unavailable',
          json: async () => ({ error: 'Unavailable' }),
        }),
    );
    expect(await findBookingRequest('synthetic')).toBeNull();
    await expect(findBookingRequest('synthetic')).rejects.toThrow('Unavailable');
  });
});
