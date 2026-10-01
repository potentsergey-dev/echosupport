import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup:
    vi.fn<
      (
        hostname: string,
        options: { all: true; verbatim: true },
      ) => Promise<Array<{ address: string; family: number }>>
    >(),
  request:
    vi.fn<
      (
        url: URL,
        options: RequestOptions,
        callback: (response: IncomingMessage) => void,
      ) => ClientRequest
    >(),
}));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:http', () => ({ request: mocks.request }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { fetchPublicHtml, isPublicAddress, isPublicHttpUrl } from '../services/public-http.js';

type Reply = { status?: number; headers?: Record<string, string>; chunks?: Buffer[] };
function respond(replies: Reply[]) {
  mocks.request.mockImplementation((_url, _options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () =>
      queueMicrotask(() => {
        const reply = replies.shift()!;
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          destroy: (error?: Error) => void;
        };
        let destroyed = false;
        res.statusCode = reply.status ?? 200;
        res.headers = reply.headers ?? { 'content-type': 'text/html' };
        res.destroy = (error) => {
          destroyed = true;
          if (error) res.emit('error', error);
        };
        callback(res as unknown as IncomingMessage);
        for (const chunk of reply.chunks ?? [Buffer.from('<p>Public page</p>')]) {
          if (!destroyed) res.emit('data', chunk);
        }
        if (!destroyed) res.emit('end');
      });
    return req as unknown as ClientRequest;
  });
}
const options = () => ({
  origin: 'https://example.com',
  signal: AbortSignal.timeout(1000),
  maxBytes: 100,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('crawler egress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.100.100.200',
    '172.16.1.1',
    '192.168.1.1',
    '0.0.0.0',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '2002:7f00:1::',
    '2001:db8::1',
  ])('rejects %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it('allows global addresses and rejects credentials, ports and non-HTTP URLs', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    for (const url of [
      'file:///etc/passwd',
      'http://localhost/',
      'http://2130706433/',
      'http://[::ffff:127.0.0.1]/',
      'https://user:pass@example.com/',
      'http://example.com:8080/',
    ]) {
      expect(isPublicHttpUrl(url)).toBe(false);
    }
  });
  it('rejects a hostname if any DNS address is private', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(fetchPublicHtml('https://example.com', options())).rejects.toThrow('non-public');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('pins the validated address while preserving the original hostname', async () => {
    respond([{}]);
    await expect(fetchPublicHtml('https://example.com', options())).resolves.toMatchObject({
      html: '<p>Public page</p>',
    });
    const [url, config] = mocks.request.mock.calls[0]!;
    expect(url.hostname).toBe('example.com');
    const callback = vi.fn();
    config.lookup!('example.com', { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(config.agent).toBe(false);
  });
  it('rejects a redirect to metadata before opening its connection', async () => {
    respond([{ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }]);
    await expect(fetchPublicHtml('https://example.com', options())).rejects.toThrow('not allowed');
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('rechecks DNS on a same-origin redirect and rejects rebinding', async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    respond([{ status: 302, headers: { location: '/next' } }]);
    await expect(fetchPublicHtml('https://example.com', options())).rejects.toThrow('non-public');
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('limits redirects and streamed bytes without trusting Content-Length', async () => {
    respond([
      { status: 302, headers: { location: '/next' } },
      { status: 302, headers: { location: '/' } },
    ]);
    await expect(
      fetchPublicHtml('https://example.com', { ...options(), maxRedirects: 1 }),
    ).rejects.toThrow('redirect limit');
    respond([{ chunks: [Buffer.alloc(60), Buffer.alloc(60)] }]);
    await expect(fetchPublicHtml('https://example.com', options())).rejects.toThrow('byte limit');
  });
  it('enforces deadlines while resolving DNS and rejects compressed bodies', async () => {
    mocks.lookup.mockReturnValue(new Promise(() => {}));
    const signal = AbortSignal.timeout(20);
    await expect(
      fetchPublicHtml('https://example.com', { ...options(), signal }),
    ).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    respond([{ headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } }]);
    await expect(fetchPublicHtml('https://example.com', options())).rejects.toThrow(
      'unsupported encoding',
    );
  });
});
