import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PublicHttp from '../services/public-http.js';
vi.mock('../services/public-http.js', async (importOriginal) => ({
  ...(await importOriginal<typeof PublicHttp>()),
  fetchPublicHtml: vi.fn(),
}));
import { fetchPublicHtml } from '../services/public-http.js';
import { crawlUrl } from '../services/crawler.js';
vi.mock('../services/crawler-parser.js', () => ({ parseCrawlPage: vi.fn() }));
import { parseCrawlPage } from '../services/crawler-parser.js';

const html = `<article><h1>Documentation</h1><p>${'Useful documented information. '.repeat(30)}</p></article>`;
const links = Array.from({ length: 1100 }, (_, index) => `<a href="/page${index}">page</a>`).join(
  '',
);
beforeEach(() => {
  vi.mocked(fetchPublicHtml).mockReset();
  vi.mocked(parseCrawlPage).mockResolvedValue({
    text: 'Documentation',
    links: Array.from({ length: 1100 }, (_, index) => `https://example.com/page${index}`),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('crawl budgets', () => {
  it('counts failed pages toward the visit limit instead of counting only results', async () => {
    vi.mocked(fetchPublicHtml)
      .mockResolvedValueOnce({ url: 'https://example.com/', html: html + links, bytes: 1000 })
      .mockResolvedValue(null);
    await crawlUrl('https://example.com/', { maxPages: 3 });
    expect(fetchPublicHtml).toHaveBeenCalledTimes(3);
  });
  it('bounds total downloaded bytes across pages, including skipped responses', async () => {
    vi.mocked(fetchPublicHtml).mockImplementation(async (url, options) => {
      options.onBytes?.(options.maxBytes);
      return { url, html: html + links, bytes: options.maxBytes };
    });
    await crawlUrl('https://example.com/', { maxDepth: 5 });
    expect(fetchPublicHtml).toHaveBeenCalledTimes(5);
    for (const [, options] of vi.mocked(fetchPublicHtml).mock.calls)
      expect(options.maxBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
  it('stops scheduling pages when the overall crawl deadline expires', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(fetchPublicHtml).mockImplementation(async (url) => {
      now += 15_000;
      return { url, html: html + links, bytes: 1000 };
    });
    await crawlUrl('https://example.com/', { maxDepth: 5 });
    expect(fetchPublicHtml).toHaveBeenCalledTimes(4);
  });
});
