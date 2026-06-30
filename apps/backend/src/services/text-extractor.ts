import { readFile } from '../adapters/storage/local-fs.js';

export async function extractText(storagePath: string, mimeType: string): Promise<string> {
  switch (mimeType) {
    case 'application/pdf':
      return extractPdf(storagePath);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractDocx(storagePath);
    case 'text/html':
      return extractHtml(storagePath);
    default:
      // text/plain, text/markdown, text/x-markdown, etc.
      return (await readFile(storagePath)).toString('utf-8');
  }
}

async function extractPdf(storagePath: string): Promise<string> {
  const buffer = await readFile(storagePath);
  // pdf-parse is a CJS module; cast via unknown to satisfy the ESM type declarations
  const { default: pdfParse } = (await import('pdf-parse')) as unknown as {
    default: (buf: Buffer) => Promise<{ text: string }>;
  };
  const data = await pdfParse(buffer);
  return data.text;
}

async function extractDocx(storagePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: storagePath });
  return result.value;
}

async function extractHtml(storagePath: string): Promise<string> {
  const { JSDOM } = await import('jsdom');
  const { Readability } = await import('@mozilla/readability');
  const buffer = await readFile(storagePath);
  const html = buffer.toString('utf-8');
  const dom = new JSDOM(html, { url: 'https://placeholder.local' });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  return article?.textContent?.trim() ?? '';
}
