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
  const maxPages = opts.maxPages ?? 100;

  const { JSDOM } = await import('jsdom');
  const { Readability } = await import('@mozilla/readability');

  let baseOrigin: string;
  try {
    baseOrigin = new URL(startUrl).origin;
  } catch {
    return [];
  }

  const visited = new Set<string>();
  const results: CrawlResult[] = [];
  const queue: Array<[string, number]> = [[startUrl, 0]];

  while (queue.length > 0 && results.length < maxPages) {
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
      const response = await fetch(currentUrl, {
        headers: { 'User-Agent': 'EchoSupport-Crawler/1.0' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) continue;

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html')) continue;

      const html = await response.text();

      // Extract links before Readability mutates the DOM
      const linkDom = new JSDOM(html, { url: currentUrl });
      const linkNodes = linkDom.window.document.querySelectorAll('a[href]');
      const links: string[] = [];
      for (const node of Array.from(linkNodes)) {
        const href = node.getAttribute('href');
        if (!href) continue;
        try {
          links.push(new URL(href, currentUrl).toString().split('#')[0] ?? '');
        } catch {
          // ignore invalid URLs
        }
      }

      // Extract readable text
      const textDom = new JSDOM(html, { url: currentUrl });
      const reader = new Readability(textDom.window.document);
      const article = reader.parse();
      const text = article?.textContent?.trim() ?? '';

      if (text.length > 0) {
        results.push({ url: currentUrl, text });
      }

      // Enqueue child links
      if (depth < maxDepth) {
        for (const link of links) {
          if (!visited.has(link)) {
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
