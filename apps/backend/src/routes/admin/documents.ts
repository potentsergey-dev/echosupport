import type { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { saveFile, deleteFile } from '../../adapters/storage/local-fs.js';
import { deleteByDocumentId, deleteBySourceId } from '../../adapters/vectorstore/qdrant.js';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/html',
]);

const AddSourceSchema = z.object({
  url: z.string().url(),
  maxDepth: z.number().int().min(0).max(5).default(1),
  includePaths: z.array(z.string()).default([]),
  excludePaths: z.array(z.string()).default([]),
});

async function assertAgentOwnership(tenantId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, tenantId } });
  if (!agent) {
    const err = Object.assign(new Error('Agent not found'), { statusCode: 404 });
    throw err;
  }
  return agent;
}

const documentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireRole(['OWNER', 'ADMIN']));

  // ── GET /admin/agents/:id/documents ────────────────────────────────────────
  fastify.get('/agents/:id/documents', async (req, reply) => {
    const { id } = req.params as { id: string };
    await assertAgentOwnership(req.user.tenantId, id);

    const docs = await prisma.document.findMany({
      where: { agentId: id },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        chunksCount: true,
        errorMessage: true,
        createdAt: true,
        indexedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send(docs);
  });

  // ── POST /admin/agents/:id/documents ───────────────────────────────────────
  fastify.post('/agents/:id/documents', async (req, reply) => {
    const { id: agentId } = req.params as { id: string };
    await assertAgentOwnership(req.user.tenantId, agentId);

    const maxBytes = env.MAX_DOCUMENT_SIZE_MB * 1024 * 1024;
    const data = await req.file({ limits: { fileSize: maxBytes } });
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    if (!ALLOWED_MIME.has(data.mimetype)) {
      data.file.resume();
      return reply.status(400).send({
        error: `Unsupported file type: ${data.mimetype}. Allowed: pdf, txt, md, docx, html`,
      });
    }

    const chunks: Buffer[] = [];
    let totalSize = 0;
    for await (const chunk of data.file as AsyncIterable<Buffer>) {
      totalSize += chunk.length;
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const ext = path.extname(data.filename) || '';
    const docId = randomUUID();
    const storagePath = await saveFile(agentId, `${docId}${ext}`, buffer);

    const doc = await prisma.document.create({
      data: {
        agentId,
        filename: data.filename,
        mimeType: data.mimetype,
        sizeBytes: totalSize,
        storagePath,
        status: 'PENDING',
      },
    });

    return reply.status(201).send(doc);
  });

  // ── DELETE /admin/agents/:id/documents/:docId ──────────────────────────────
  fastify.delete('/agents/:id/documents/:docId', async (req, reply) => {
    const { id: agentId, docId } = req.params as { id: string; docId: string };
    const agent = await assertAgentOwnership(req.user.tenantId, agentId);

    const doc = await prisma.document.findFirst({ where: { id: docId, agentId } });
    if (!doc) return reply.status(404).send({ error: 'Document not found' });

    await deleteByDocumentId(agent.tenantId, docId);
    await prisma.documentChunk.deleteMany({ where: { documentId: docId } });
    await deleteFile(doc.storagePath);
    await prisma.document.delete({ where: { id: docId } });

    return reply.status(204).send();
  });

  // ── GET /admin/agents/:id/sources ──────────────────────────────────────────
  fastify.get('/agents/:id/sources', async (req, reply) => {
    const { id } = req.params as { id: string };
    await assertAgentOwnership(req.user.tenantId, id);

    const sources = await prisma.knowledgeSource.findMany({
      where: { agentId: id },
      select: {
        id: true,
        url: true,
        maxDepth: true,
        includePaths: true,
        excludePaths: true,
        status: true,
        pagesIndexed: true,
        errorMessage: true,
        createdAt: true,
        indexedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send(sources);
  });

  // ── POST /admin/agents/:id/sources ─────────────────────────────────────────
  fastify.post('/agents/:id/sources', async (req, reply) => {
    const { id: agentId } = req.params as { id: string };
    await assertAgentOwnership(req.user.tenantId, agentId);

    const parsed = AddSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const source = await prisma.knowledgeSource.create({
      data: {
        agentId,
        url: parsed.data.url,
        maxDepth: parsed.data.maxDepth,
        includePaths: parsed.data.includePaths,
        excludePaths: parsed.data.excludePaths,
        status: 'PENDING',
      },
    });

    return reply.status(201).send(source);
  });

  // ── DELETE /admin/agents/:id/sources/:sourceId ─────────────────────────────
  fastify.delete('/agents/:id/sources/:sourceId', async (req, reply) => {
    const { id: agentId, sourceId } = req.params as { id: string; sourceId: string };
    const agent = await assertAgentOwnership(req.user.tenantId, agentId);

    const source = await prisma.knowledgeSource.findFirst({ where: { id: sourceId, agentId } });
    if (!source) return reply.status(404).send({ error: 'Source not found' });

    await deleteBySourceId(agent.tenantId, sourceId);
    await prisma.documentChunk.deleteMany({ where: { sourceId } });
    await prisma.knowledgeSource.delete({ where: { id: sourceId } });

    return reply.status(204).send();
  });

  // ── POST /admin/agents/:id/reindex ─────────────────────────────────────────
  fastify.post('/agents/:id/reindex', async (req, reply) => {
    const { id: agentId } = req.params as { id: string };
    await assertAgentOwnership(req.user.tenantId, agentId);

    const job = await prisma.job.create({
      data: {
        type: 'REINDEX_AGENT',
        agentId,
        payload: { agentId },
        status: 'PENDING',
      },
    });

    return reply.status(202).send({ jobId: job.id });
  });
};

export default documentRoutes;
