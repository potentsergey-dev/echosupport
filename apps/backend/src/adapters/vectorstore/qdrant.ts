import { QdrantClient, type Schemas } from '@qdrant/js-client-rest';
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
  await getClient().createPayloadIndex(name, {
    field_name: 'index_generation',
    field_schema: 'keyword',
  });
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export type QdrantSearchPoint = Schemas['ScoredPoint'];

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

export async function deleteByIndexGeneration(
  tenantId: string,
  agentId: string,
  generation: string,
): Promise<void> {
  const name = getCollectionName(tenantId);
  if (!(await collectionExists(name))) return;
  await getClient().delete(name, {
    wait: true,
    filter: {
      must: [
        { key: 'agent_id', match: { value: agentId } },
        { key: 'index_generation', match: { value: generation } },
      ],
    },
  });
}

export async function deleteLegacyAgentPoints(tenantId: string, agentId: string): Promise<void> {
  const name = getCollectionName(tenantId);
  if (!(await collectionExists(name))) return;
  for await (const ids of legacyPointIds(name, agentId)) {
    if (ids.length > 0) await getClient().delete(name, { wait: true, points: ids });
  }
}

function isLegacyGeneration(payload: Record<string, unknown> | null | undefined): boolean {
  const generation = payload?.['index_generation'];
  return generation == null || (Array.isArray(generation) && generation.length === 0);
}

async function* legacyPointIds(
  name: string,
  agentId: string,
  sourceType?: 'FILE' | 'URL',
): AsyncGenerator<Array<string | number>> {
  let offset: string | number | Record<string, unknown> | undefined;
  do {
    const page = await getClient().scroll(name, {
      filter: { must: [{ key: 'agent_id', match: { value: agentId } }] },
      limit: 256,
      with_payload: ['index_generation', 'source_type'],
      with_vector: false,
      ...(offset == null ? {} : { offset }),
    });
    yield page.points
      .filter(
        (point) =>
          isLegacyGeneration(point.payload) &&
          (!sourceType || point.payload?.['source_type'] === sourceType),
      )
      .map((point) => point.id);
    offset = page.next_page_offset ?? undefined;
  } while (offset != null);
}

export async function searchLegacyPoints(
  tenantId: string,
  agentId: string,
  vector: number[],
  limit = 5,
  sourceType?: 'FILE' | 'URL',
): Promise<QdrantSearchPoint[]> {
  const name = getCollectionName(tenantId);
  const results: QdrantSearchPoint[] = [];
  for await (const ids of legacyPointIds(name, agentId, sourceType)) {
    if (ids.length === 0) continue;
    const response = await getClient().query(name, {
      query: vector,
      filter: { must: [{ key: 'agent_id', match: { value: agentId } }, { has_id: ids }] },
      limit,
      with_payload: true,
    });
    results.push(...response.points);
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
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
  filter: Schemas['Filter'],
  limit = 5,
): Promise<QdrantSearchPoint[]> {
  const response = await getClient().query(getCollectionName(tenantId), {
    query: vector,
    filter,
    limit,
    with_payload: true,
  });
  return response.points;
}
