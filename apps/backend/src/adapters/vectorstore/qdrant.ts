import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../../config/env.js';

const VECTOR_SIZE = 1536;

let _client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (!_client) {
    _client = new QdrantClient({
      url: env.QDRANT_URL,
      ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
    });
  }
  return _client;
}

export async function checkQdrantConnection(): Promise<void> {
  await getClient().getCollections();
}

export function getCollectionName(tenantId: string): string {
  return `kb_tenant_${tenantId}`;
}

async function collectionExists(name: string): Promise<boolean> {
  const { collections } = await getClient().getCollections();
  return collections.some((c) => c.name === name);
}

export async function ensureCollection(tenantId: string): Promise<void> {
  const name = getCollectionName(tenantId);
  if (await collectionExists(name)) return;

  await getClient().createCollection(name, {
    vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
    optimizers_config: { default_segment_number: 2 },
  });

  await getClient().createPayloadIndex(name, {
    field_name: 'agent_id',
    field_schema: 'keyword',
  });
  await getClient().createPayloadIndex(name, {
    field_name: 'source_type',
    field_schema: 'keyword',
  });
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export async function upsertPoints(tenantId: string, points: QdrantPoint[]): Promise<void> {
  if (points.length === 0) return;
  await getClient().upsert(getCollectionName(tenantId), { wait: true, points });
}

export async function deleteByAgentId(tenantId: string, agentId: string): Promise<void> {
  const name = getCollectionName(tenantId);
  if (!(await collectionExists(name))) return;
  await getClient().delete(name, {
    wait: true,
    filter: { must: [{ key: 'agent_id', match: { value: agentId } }] },
  });
}

export async function deleteByDocumentId(tenantId: string, documentId: string): Promise<void> {
  const name = getCollectionName(tenantId);
  if (!(await collectionExists(name))) return;
  await getClient().delete(name, {
    wait: true,
    filter: { must: [{ key: 'document_id', match: { value: documentId } }] },
  });
}

export async function deleteBySourceId(tenantId: string, sourceId: string): Promise<void> {
  const name = getCollectionName(tenantId);
  if (!(await collectionExists(name))) return;
  await getClient().delete(name, {
    wait: true,
    filter: { must: [{ key: 'source_id', match: { value: sourceId } }] },
  });
}

export async function searchPoints(
  tenantId: string,
  vector: number[],
  filter: Record<string, unknown>,
  limit = 5,
) {
  return getClient().search(getCollectionName(tenantId), {
    vector,
    filter,
    limit,
    with_payload: true,
  });
}
