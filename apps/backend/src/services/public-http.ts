import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
  return false;
}

export function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '80' || url.port === '443') &&
      host !== 'localhost' &&
      !host.endsWith('.localhost') &&
      (!isIP(host) || isPublicAddress(host))
    );
  } catch {
    return false;
  }
}

export interface PublicPage {
  url: string;
  html: string;
  bytes: number;
}

/** Resolve once and pin the checked address to the connection, preserving Host and TLS SNI. */
export async function fetchPublicHtml(
  value: string,
  options: {
    origin: string;
    signal: AbortSignal;
    maxBytes: number;
    maxRedirects?: number;
    onBytes?: (bytes: number) => void;
  },
): Promise<PublicPage | null> {
  let url = new URL(value);
  for (let redirects = 0; redirects <= (options.maxRedirects ?? 5); redirects++) {
    options.signal.throwIfAborted();
    if (!isPublicHttpUrl(url.href) || url.origin !== options.origin) {
      throw new Error('Crawler destination is not allowed');
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
          const aborted = () => reject(options.signal.reason);
          options.signal.addEventListener('abort', aborted, { once: true });
          if (options.signal.aborted) aborted();
          lookup(hostname, { all: true, verbatim: true })
            .then(resolve, reject)
            .finally(() => {
              options.signal.removeEventListener('abort', aborted);
            });
        });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new Error('Crawler destination resolves to a non-public address');
    }
    const pinned = addresses[0]!;
    const result = await new Promise<{ redirect?: string; page: PublicPage | null }>(
      (resolve, reject) => {
        const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
        const req = request(
          url,
          {
            agent: false,
            signal: options.signal,
            headers: { 'User-Agent': 'EchoSupport-Crawler/1.0', 'Accept-Encoding': 'identity' },
            // No second DNS lookup: neither rebinding nor connection reuse can change the destination.
            lookup: (_host, _opts, callback) => callback(null, pinned.address, pinned.family),
            family: pinned.family,
            maxHeaderSize: 16 * 1024,
          },
          (response) => {
            const status = response.statusCode ?? 0;
            if ([301, 302, 303, 307, 308].includes(status)) {
              const location = response.headers.location;
              response.destroy();
              if (!location) reject(new Error('Redirect without location'));
              else resolve({ redirect: location, page: null });
              return;
            }
            if (
              status < 200 ||
              status >= 300 ||
              !response.headers['content-type']?.toLowerCase().includes('text/html')
            ) {
              response.destroy();
              resolve({ page: null });
              return;
            }
            const declared = Number(response.headers['content-length']);
            const encoding = response.headers['content-encoding'];
            if (
              (Number.isFinite(declared) && declared > options.maxBytes) ||
              (encoding && encoding !== 'identity')
            ) {
              response.destroy();
              reject(new Error('Crawler response exceeds limits or uses unsupported encoding'));
              return;
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              options.onBytes?.(chunk.length);
              if (bytes > options.maxBytes) {
                response.destroy(new Error('Crawler response exceeds byte limit'));
                return;
              }
              chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () =>
              resolve({
                page: { url: url.href, html: Buffer.concat(chunks).toString('utf8'), bytes },
              }),
            );
          },
        );
        req.on('error', reject);
        req.end();
      },
    );
    if (!result.redirect) return result.page;
    url = new URL(result.redirect, url);
  }
  throw new Error('Crawler redirect limit exceeded');
}
