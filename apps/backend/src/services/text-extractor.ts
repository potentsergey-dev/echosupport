import type { StorageAdapter } from '../contracts/infrastructure.js';

export async function extractText(
  storage: Pick<StorageAdapter, 'readFile'>,
  storagePath: string,
  mimeType: string,
): Promise<string> {
  switch (mimeType) {
    case 'application/pdf':
      return extractPdf(storage, storagePath);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractDocx(storage, storagePath);
    case 'text/html':
      return extractHtml(storage, storagePath);
    default:
      // text/plain, text/markdown, text/x-markdown, etc.
      return (await storage.readFile(storagePath)).toString('utf-8');
  }
}

async function extractPdf(
  storage: Pick<StorageAdapter, 'readFile'>,
  storagePath: string,
): Promise<string> {
  const buffer = await storage.readFile(storagePath);
  // pdf-parse is a CJS module; cast via unknown to satisfy the ESM type declarations
  const { default: pdfParse } = (await import('pdf-parse')) as unknown as {
    default: (buf: Buffer) => Promise<{ text: string }>;
  };
  const data = await pdfParse(buffer);
  return data.text;
}

async function extractDocx(
  storage: Pick<StorageAdapter, 'readFile'>,
  storagePath: string,
): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: await storage.readFile(storagePath) });
  return result.value;
}

async function extractHtml(
  storage: Pick<StorageAdapter, 'readFile'>,
  storagePath: string,
): Promise<string> {
  const { JSDOM } = await import('jsdom');
  const { Readability } = await import('@mozilla/readability');
  const buffer = await storage.readFile(storagePath);
  const html = buffer.toString('utf-8');
  const dom = new JSDOM(html, { url: 'https://placeholder.local' });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  return article?.textContent?.trim() ?? '';
}
