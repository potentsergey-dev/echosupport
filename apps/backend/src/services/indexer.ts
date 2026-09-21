import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { embed } from '../adapters/embeddings/openai.js';
import {
  ensureCollection,
  upsertPoints,
  deleteByIndexGeneration,
  type QdrantPoint,
} from '../adapters/vectorstore/qdrant.js';
import { extractText } from './text-extractor.js';
import { chunkText } from './chunker.js';
import { crawlUrl } from './crawler.js';
import { sanitizeErrorMessage } from './error-sanitizer.js';
import { resolveEmbeddingConfig } from './resolve-embedding.js';
import { createJobLeaseService } from './job-leases.js';
import type { StorageAdapter } from '../contracts/infrastructure.js';

const EMBED_BATCH = 50;
const leases = createJobLeaseService(prisma);

async function setJobProgress(jobId: string, token: string, progress: number): Promise<void> {
  await leases.withLease(jobId, token, (tx) =>
    tx.job.update({ where: { id: jobId }, data: { progress } }).then(() => undefined),
  );
}

export async function reindexAgent(
  agentId: string,
  jobId: string,
  storage: Pick<StorageAdapter, 'readFile' | 'readFileVersion'>,
  token: string,
): Promise<void> {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: { documents: true, sources: true },
  });

  const embeddingCfg = await resolveEmbeddingConfig(agentId, agent.embeddingModel);

  await ensureCollection(agent.tenantId);
  const generation = randomUUID();
  const baseline = agent.activeIndexGeneration;
  const documentResults: Array<{ id: string; chunksCount: number }> = [];
  const sourceResults: Array<{ id: string; pagesIndexed: number }> = [];

  const totalItems = agent.documents.length + agent.sources.length;
  let failedItems = 0;
  let processedItems = 0;
  let publicationStarted = false;
  const failures: string[] = [];

  const reportProgress = async () => {
    const pct =
      totalItems === 0 ? 99 : Math.min(Math.round((processedItems / totalItems) * 99), 99);
    await setJobProgress(jobId, token, pct);
  };

  try {
    // ── Process documents ──────────────────────────────────────────────────────
    for (const doc of agent.documents) {
      try {
        const version = doc.storageVersion;
        if (version && !storage.readFileVersion) {
          throw new Error('Storage adapter cannot read pinned object versions');
        }
        const sourceStorage = version
          ? { readFile: (storagePath: string) => storage.readFileVersion!(storagePath, version) }
          : storage;
        const text = await extractText(sourceStorage, doc.storagePath, doc.mimeType);
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
              index_generation: generation,
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
            indexGeneration: generation,
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

        documentResults.push({ id: doc.id, chunksCount: chunks.length });
      } catch (err: unknown) {
        failedItems++;
        failures.push(`${doc.filename}: ${sanitizeErrorMessage(err)}`);
      }

      processedItems++;
      await reportProgress();
    }

    // ── Process knowledge sources ──────────────────────────────────────────────
    for (const source of agent.sources) {
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
                index_generation: generation,
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
              indexGeneration: generation,
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

        sourceResults.push({ id: source.id, pagesIndexed: pages.length });
      } catch (err: unknown) {
        failedItems++;
        failures.push(`Source ${source.id}: ${sanitizeErrorMessage(err)}`);
      }

      processedItems++;
      await reportProgress();
    }

    if (failedItems > 0) {
      throw new Error(
        `${failedItems} knowledge item${failedItems === 1 ? '' : 's'} failed to index: ${failures.slice(0, 3).join('; ')}`,
      );
    }

    publicationStarted = true;
    await leases.withLease(jobId, token, async (tx) => {
      const updated = await tx.agent.updateMany({
        where: { id: agentId, activeIndexGeneration: baseline },
        data: { activeIndexGeneration: generation },
      });
      if (updated.count !== 1) throw new Error('Agent index changed during reindex');

      for (const result of documentResults) {
        const row = await tx.document.updateMany({
          where: { id: result.id, agentId },
          data: {
            status: 'INDEXED',
            chunksCount: result.chunksCount,
            indexedAt: new Date(),
            errorMessage: null,
          },
        });
        if (row.count !== 1) throw new Error('Document changed during reindex');
      }
      for (const result of sourceResults) {
        const row = await tx.knowledgeSource.updateMany({
          where: { id: result.id, agentId },
          data: {
            status: 'INDEXED',
            pagesIndexed: result.pagesIndexed,
            indexedAt: new Date(),
            errorMessage: null,
          },
        });
        if (row.count !== 1) throw new Error('Knowledge source changed during reindex');
      }
      await tx.documentChunk.deleteMany({
        where: {
          agentId,
          OR: [{ indexGeneration: null }, { indexGeneration: { not: generation } }],
        },
      });
      await tx.job.update({ where: { id: jobId }, data: { progress: 100 } });
    });
  } finally {
    if (!publicationStarted) {
      // Once publication starts, a lost commit acknowledgement makes cleanup unsafe.
      const current = await prisma.agent
        .findUnique({
          where: { id: agentId },
          select: { activeIndexGeneration: true },
        })
        .catch(() => null);
      if (current && current.activeIndexGeneration !== generation) {
        await deleteByIndexGeneration(agent.tenantId, agentId, generation).catch((error: unknown) =>
          console.warn(
            '[indexer] Failed to remove staged Qdrant points:',
            sanitizeErrorMessage(error),
          ),
        );
        await prisma.documentChunk
          .deleteMany({ where: { agentId, indexGeneration: generation } })
          .catch((error: unknown) =>
            console.warn('[indexer] Failed to remove staged chunks:', sanitizeErrorMessage(error)),
          );
      }
    }
  }
}
