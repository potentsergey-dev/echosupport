import { fetchPublicHtml, isPublicHttpUrl } from './public-http.js';
import { parseCrawlPage } from './crawler-parser.js';

export interface CrawlResult {
  url: string;
  text: string;
}

export interface CrawlOptions {
  maxDepth?: number;
  includePaths?: string[];
  excludePaths?: string[];
  maxPages?: number;
}

function matchesPatterns(pathname: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(pathname);
  });
}

function shouldCrawl(pathname: string, includePaths: string[], excludePaths: string[]): boolean {
  if (excludePaths.length > 0 && matchesPatterns(pathname, excludePaths)) return false;
  if (includePaths.length > 0 && !matchesPatterns(pathname, includePaths)) return false;
  return true;
}

export async function crawlUrl(startUrl: string, opts: CrawlOptions = {}): Promise<CrawlResult[]> {
  const maxDepth = opts.maxDepth ?? 1;
  const includePaths = opts.includePaths ?? [];
  const excludePaths = opts.excludePaths ?? [];
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 100, 100));
  const deadline = Date.now() + 60_000;
  const crawlSignal = AbortSignal.timeout(60_000);
  let remainingBytes = 10 * 1024 * 1024;

  let baseOrigin: string;
  try {
    if (!isPublicHttpUrl(startUrl)) throw new Error('Crawler destination is not allowed');
    baseOrigin = new URL(startUrl).origin;
  } catch {
    return [];
  }

  const visited = new Set<string>();
  const results: CrawlResult[] = [];
  const queue: Array<[string, number]> = [[startUrl, 0]];

  const queued = new Set([startUrl.split('#')[0] ?? '']);
  while (
    queue.length > 0 &&
    visited.size < maxPages &&
    remainingBytes > 0 &&
    Date.now() < deadline
  ) {
    const item = queue.shift();
    if (!item) break;
    const [currentUrl, depth] = item;

    const normalized = currentUrl.split('#')[0] ?? '';
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(currentUrl);
    } catch {
      continue;
    }

    if (parsedUrl.origin !== baseOrigin) continue;
    if (!shouldCrawl(parsedUrl.pathname, includePaths, excludePaths)) continue;

    try {
      const page = await fetchPublicHtml(currentUrl, {
        origin: baseOrigin,
        signal: AbortSignal.any([crawlSignal, AbortSignal.timeout(15_000)]),
        maxBytes: Math.min(2 * 1024 * 1024, remainingBytes),
        onBytes: (bytes) => {
          remainingBytes -= bytes;
        },
      });
      if (!page) continue;
      const { html } = page;

      const { text, links } = await parseCrawlPage(html, page.url, crawlSignal);

      if (text.length > 0) {
        results.push({ url: page.url, text });
      }

      // Enqueue child links
      if (depth < maxDepth) {
        for (const link of links) {
          if (
            new URL(link).origin === baseOrigin &&
            isPublicHttpUrl(link) &&
            !visited.has(link) &&
            !queued.has(link) &&
            queued.size < 1000
          ) {
            queued.add(link);
            queue.push([link, depth + 1]);
          }
        }
      }
    } catch {
      // Skip pages that fail to fetch/parse
    }
  }

  return results;
}
