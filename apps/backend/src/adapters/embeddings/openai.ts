import OpenAI from 'openai';

const BATCH_SIZE = 100;

export async function embed(
  texts: string[],
  apiKey: string,
  model = 'text-embedding-3-small',
  baseURL?: string,
): Promise<number[][]> {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await client.embeddings.create({ model, input: batch });
    const sorted = response.data.sort((a, b) => a.index - b.index);
    results.push(...sorted.map((d) => d.embedding));
  }

  return results;
}
