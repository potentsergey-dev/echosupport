import { embed } from '../adapters/embeddings/openai.js';
import { searchPoints } from '../adapters/vectorstore/qdrant.js';
import { prisma } from '../db/prisma.js';
import { sanitizeErrorMessage } from './error-sanitizer.js';
import { resolveEmbeddingConfig } from './resolve-embedding.js';

export interface RetrievedChunk {
  content: string;
  sourceType: 'FILE' | 'URL';
  sourceLabel: string | null;
  score: number;
}

export interface RetrieverOptions {
  topK?: number;
  sourcePriority?: 'MERGE' | 'FILES_FIRST' | 'URL_FIRST';
}

/**
 * Retrieves the most relevant knowledge chunks for the given query.
 * Respects the agent's sourcePriority setting.
 */
export async function retrieve(
  agentId: string,
  query: string,
  opts: RetrieverOptions = {},
): Promise<RetrievedChunk[]> {
  const { topK = 5, sourcePriority = 'MERGE' } = opts;

  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: { tenantId: true, embeddingModel: true },
  });

  let queryVector: number[];
  try {
    const embeddingCfg = await resolveEmbeddingConfig(agentId, agent.embeddingModel);
    const [vec] = await embed(
      [query],
      embeddingCfg.apiKey,
      embeddingCfg.model,
      embeddingCfg.baseURL,
    );
    if (!vec) return [];
    queryVector = vec;
  } catch (embedErr) {
    // Embedding may fail due to missing/invalid API key or regional restrictions.
    // Log the reason but do not block the conversation — LLM will answer without RAG context.
    console.warn(
      '[retriever] Embedding failed, skipping knowledge-base retrieval:',
      sanitizeErrorMessage(embedErr),
    );
    return [];
  }

  const agentFilter = {
    must: [{ key: 'agent_id', match: { value: agentId } }],
  };

  if (sourcePriority === 'MERGE') {
    return toChunks(await searchPoints(agent.tenantId, queryVector, agentFilter, topK));
  }

  // FILES_FIRST or URL_FIRST: try preferred source type, fall back to all if too few results
  const preferredType = sourcePriority === 'FILES_FIRST' ? 'FILE' : 'URL';
  const preferredFilter = {
    must: [
      { key: 'agent_id', match: { value: agentId } },
      { key: 'source_type', match: { value: preferredType } },
    ],
  };

  const preferred = await searchPoints(agent.tenantId, queryVector, preferredFilter, topK);
  if (preferred.length >= Math.ceil(topK / 2)) {
    return toChunks(preferred);
  }

  // Not enough from preferred source — fill from all sources
  const fallback = await searchPoints(agent.tenantId, queryVector, agentFilter, topK);
  return toChunks(fallback);
}

function toChunks(results: Awaited<ReturnType<typeof searchPoints>>): RetrievedChunk[] {
  return results.map((r) => ({
    content: String(r.payload?.['content'] ?? ''),
    sourceType: (r.payload?.['source_type'] as 'FILE' | 'URL') ?? 'FILE',
    sourceLabel: r.payload?.['source_label'] != null ? String(r.payload['source_label']) : null,
    score: r.score,
  }));
}
