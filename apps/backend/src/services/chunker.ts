import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

export async function chunkText(text: string, opts: ChunkOptions = {}): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: opts.chunkSize ?? 800,
    chunkOverlap: opts.overlap ?? 100,
  });
  const chunks = await splitter.splitText(text);
  return chunks.filter((c) => c.trim().length > 0);
}
