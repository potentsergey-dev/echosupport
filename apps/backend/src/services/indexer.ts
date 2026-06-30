import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { embed } from '../adapters/embeddings/openai.js';
import {
  ensureCollection,
  upsertPoints,
  deleteByAgentId,
  type QdrantPoint,
} from '../adapters/vectorstore/qdrant.js';
import { extractText } from './text-extractor.js';
import { chunkText } from './chunker.js';
import { crawlUrl } from './crawler.js';
import { resolveEmbeddingConfig } from './resolve-embedding.js';

const EMBED_BATCH = 50;

async function setJobProgress(jobId: string, progress: number): Promise<void> {
  await prisma.job.update({ where: { id: jobId }, data: { progress } });
}

export async function reindexAgent(agentId: string, jobId: string): Promise<void> {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: { documents: true, sources: true },
  });

  const embeddingCfg = await resolveEmbeddingConfig(agentId, agent.embeddingModel);

  await ensureCollection(agent.tenantId);

  // Delete all existing Qdrant points and PG chunks for this agent
  await deleteByAgentId(agent.tenantId, agentId);
  await prisma.documentChunk.deleteMany({ where: { agentId } });

  // Reset statuses
  await prisma.document.updateMany({
    where: { agentId },
    data: { status: 'PENDING', chunksCount: 0, errorMessage: null, indexedAt: null },
  });
  await prisma.knowledgeSource.updateMany({
    where: { agentId },
    data: { status: 'PENDING', pagesIndexed: 0, errorMessage: null, indexedAt: null },
  });

  const totalItems = agent.documents.length + agent.sources.length;
  let processedItems = 0;

  const reportProgress = async () => {
    const pct =
      totalItems === 0 ? 99 : Math.min(Math.round((processedItems / totalItems) * 99), 99);
    await setJobProgress(jobId, pct);
  };

  // ── Process documents ──────────────────────────────────────────────────────
  for (const doc of agent.documents) {
    await prisma.document.update({ where: { id: doc.id }, data: { status: 'INDEXING' } });

    try {
      const text = await extractText(doc.storagePath, doc.mimeType);
      const chunks = await chunkText(text);

      const allVectors: number[][] = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const vectors = await embed(
          chunks.slice(i, i + EMBED_BATCH),
          embeddingCfg.apiKey,
          embeddingCfg.model,
          embeddingCfg.baseURL,
        );
        allVectors.push(...vectors);
      }

      const points: QdrantPoint[] = [];
      const chunkRows: Prisma.DocumentChunkCreateManyInput[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const pointId = randomUUID();
        points.push({
          id: pointId,
          vector: allVectors[i]!,
          payload: {
            agent_id: agentId,
            tenant_id: agent.tenantId,
            document_id: doc.id,
            source_id: null,
            chunk_id: pointId,
            source_type: 'FILE',
            source_label: doc.filename,
            chunk_index: i,
            content: chunks[i]!,
            content_preview: chunks[i]!.slice(0, 200),
          },
        });
        chunkRows.push({
          id: pointId,
          agentId,
          documentId: doc.id,
          qdrantPointId: pointId,
          chunkIndex: i,
          content: chunks[i]!,
          tokensCount: Math.ceil(chunks[i]!.length / 4),
          sourceType: 'FILE',
          sourceLabel: doc.filename,
        });
      }

      await upsertPoints(agent.tenantId, points);
      await prisma.documentChunk.createMany({ data: chunkRows });

      await prisma.document.update({
        where: { id: doc.id },
        data: { status: 'INDEXED', chunksCount: chunks.length, indexedAt: new Date() },
      });
    } catch (err: unknown) {
      await prisma.document.update({
        where: { id: doc.id },
        data: { status: 'FAILED', errorMessage: String(err) },
      });
    }

    processedItems++;
    await reportProgress();
  }

  // ── Process knowledge sources ──────────────────────────────────────────────
  for (const source of agent.sources) {
    await prisma.knowledgeSource.update({ where: { id: source.id }, data: { status: 'INDEXING' } });

    try {
      const pages = await crawlUrl(source.url, {
        maxDepth: source.maxDepth,
        includePaths: source.includePaths,
        excludePaths: source.excludePaths,
      });

      const points: QdrantPoint[] = [];
      const chunkRows: Prisma.DocumentChunkCreateManyInput[] = [];

      for (const page of pages) {
        const chunks = await chunkText(page.text);

        const allVectors: number[][] = [];
        for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
          const vectors = await embed(
            chunks.slice(i, i + EMBED_BATCH),
            embeddingCfg.apiKey,
            embeddingCfg.model,
            embeddingCfg.baseURL,
          );
          allVectors.push(...vectors);
        }

        for (let i = 0; i < chunks.length; i++) {
          const pointId = randomUUID();
          points.push({
            id: pointId,
            vector: allVectors[i]!,
            payload: {
              agent_id: agentId,
              tenant_id: agent.tenantId,
              document_id: null,
              source_id: source.id,
              chunk_id: pointId,
              source_type: 'URL',
              source_label: page.url,
              chunk_index: i,
              content: chunks[i]!,
              content_preview: chunks[i]!.slice(0, 200),
            },
          });
          chunkRows.push({
            id: pointId,
            agentId,
            sourceId: source.id,
            qdrantPointId: pointId,
            chunkIndex: i,
            content: chunks[i]!,
            tokensCount: Math.ceil(chunks[i]!.length / 4),
            sourceType: 'URL',
            sourceLabel: page.url,
          });
        }
      }

      await upsertPoints(agent.tenantId, points);
      await prisma.documentChunk.createMany({ data: chunkRows });

      await prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'INDEXED', pagesIndexed: pages.length, indexedAt: new Date() },
      });
    } catch (err: unknown) {
      await prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'FAILED', errorMessage: String(err) },
      });
    }

    processedItems++;
    await reportProgress();
  }

  await setJobProgress(jobId, 100);
}
