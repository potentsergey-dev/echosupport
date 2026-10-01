import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';

export interface ParsedCrawlPage {
  links: string[];
  text: string;
}

/** Untrusted DOM parsing runs outside the API/worker heap and can be terminated. */
export async function parseCrawlPage(
  html: string,
  url: string,
  signal: AbortSignal,
): Promise<ParsedCrawlPage> {
  signal.throwIfAborted();
  const compiled = new URL('./crawler-parser-worker.js', import.meta.url);
  const script = existsSync(compiled)
    ? compiled
    : new URL('./crawler-parser-worker.ts', import.meta.url);
  const worker = new Worker(script, {
    workerData: { html, url },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    execArgv: script.pathname.endsWith('.ts') ? ['--experimental-strip-types'] : [],
  });
  try {
    return await new Promise<ParsedCrawlPage>((resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
      const finish = () => signal.removeEventListener('abort', aborted);
      worker.once('message', (page: ParsedCrawlPage) => {
        finish();
        resolve(page);
      });
      worker.once('error', (error) => {
        finish();
        reject(error);
      });
      worker.once('exit', (code) => {
        finish();
        reject(new Error(`Crawler parser exited (${code})`));
      });
    });
  } finally {
    await worker.terminate();
  }
}
