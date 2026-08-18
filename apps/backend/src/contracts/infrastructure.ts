import type { FastifyRequest } from 'fastify';
import type {
  EntitlementContext,
  EntitlementProvider,
  FeatureKey,
  QuotaKey,
} from './entitlements.js';

export interface StorageAdapter {
  saveFile(namespaceId: string, filename: string, buffer: Buffer): Promise<string>;
  readFile(storagePath: string): Promise<Buffer>;
  deleteFile(storagePath: string): Promise<void>;
}

export type JobName = 'REINDEX_AGENT' | 'CRAWL_URL' | 'CLEANUP_SESSIONS' | 'SUMMARIZE_SESSION';

export type JobPayloadByName = {
  REINDEX_AGENT: { agentId: string };
  CRAWL_URL: { sourceId: string; agentId: string };
  CLEANUP_SESSIONS: Record<string, never>;
  SUMMARIZE_SESSION: { sessionId: string };
};

export interface JobDispatcher {
  enqueue<TName extends JobName>(
    name: TName,
    payload: JobPayloadByName[TName],
    options?: { agentId?: string; runAt?: Date },
  ): Promise<{ id: string }>;
}

export interface WorkerRunner {
  start(): Promise<WorkerHandle>;
}

export interface WorkerHandle {
  stop(): Promise<void>;
}

export interface RealtimeSocket {
  readyState: number;
  send(payload: string): void;
}

export interface RealtimeEventBus<TEvent = unknown> {
  registerOperator(tenantId: string, socket: RealtimeSocket): void;
  unregisterOperator(tenantId: string, socket: RealtimeSocket): void;
  registerVisitor(sessionId: string, socket: RealtimeSocket): void;
  unregisterVisitor(sessionId: string, socket: RealtimeSocket): void;
  publishToOperators(tenantId: string, event: TEvent): void;
  publishToVisitor(sessionId: string, event: TEvent): void;
}

export interface WorkspaceAuthContext {
  userId: string;
  email: string;
  tenantId: string;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR';
}

export interface AuthWorkspaceAdapter {
  authenticateRequest(request: FastifyRequest): Promise<WorkspaceAuthContext>;
  assertWorkspaceAccess(context: WorkspaceAuthContext, workspaceId: string): Promise<void>;
}

export interface MeteringSink {
  record(event: {
    tenantId: string;
    feature?: FeatureKey;
    quota?: QuotaKey;
    quantity: number;
    occurredAt: Date;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<void>;
}

export interface EntitlementAdapter extends EntitlementProvider {
  getSnapshot(context: EntitlementContext): ReturnType<EntitlementProvider['getSnapshot']>;
}
