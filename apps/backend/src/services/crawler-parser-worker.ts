import { parentPort, workerData } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

if (parentPort) {
  const { html, url } = workerData as { html: string; url: string };
  const dom = new JSDOM(html, { url });
  try {
    const links: string[] = [];
    for (const node of dom.window.document.querySelectorAll('a[href]')) {
      if (links.length >= 1000) break;
      const href = node.getAttribute('href');
      if (!href) continue;
      try {
        links.push(new URL(href, url).href.split('#')[0]!);
      } catch {
        /* Invalid link. */
      }
    }
    const article = new Readability(dom.window.document).parse();
    parentPort.postMessage({ links, text: article?.textContent?.trim() ?? '' });
  } finally {
    dom.window.close();
  }
}
