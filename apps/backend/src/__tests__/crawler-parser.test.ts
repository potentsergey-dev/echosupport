import { describe, expect, it } from 'vitest';
import { parseCrawlPage } from '../services/crawler-parser.js';

describe('isolated crawler parser', () => {
  it('extracts text and links without executing supplied scripts', async () => {
    const result = await parseCrawlPage(
      `<article><h1>Docs</h1><p>${'Documented information. '.repeat(30)}</p><a href="/next">Next</a><script>document.querySelector('p').textContent = 'executed'; document.querySelector('a').href = '/executed';</script></article>`,
      'https://example.com/',
      AbortSignal.timeout(60_000),
    );
    expect(result.text).toContain('Documented information');
    expect(result.links).toEqual(['https://example.com/next']);
  }, 65_000);
  it('terminates parsing when its budget expires', async () => {
    await expect(
      parseCrawlPage('<p>Text</p>', 'https://example.com/', AbortSignal.timeout(1)),
    ).rejects.toThrow();
  });
});
