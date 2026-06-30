/**
 * Realtime hub — in-memory pub/sub for WebSocket events.
 *
 * Phase 10.5: single-process pub/sub.
 * Phase 13: replace with Redis pub/sub for horizontal scaling.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface RealtimeSocket {
  readyState: number;
  send(payload: string): void;
}

const OPEN_WEBSOCKET = 1;

export type HubEvent =
  | { type: 'session:new'; tenantId: string; session: SessionSummary }
  | { type: 'session:status'; tenantId: string; sessionId: string; status: string }
  | { type: 'session:message'; tenantId: string; sessionId: string; message: MessageSummary }
  | { type: 'operator:typing'; tenantId: string; sessionId: string; userId: string }
  | { type: 'operator:message'; sessionId: string; content: string; authorId: string | null }
  | { type: 'operator:joined'; sessionId: string; operatorName: string }
  | { type: 'operator:typing_visitor'; sessionId: string }
  | { type: 'appointment:new'; tenantId: string; appointment: AppointmentSummary };

export interface SessionSummary {
  id: string;
  agentId: string;
  status: string;
  visitorName: string | null;
  pageUrl: string | null;
  lastActiveAt: Date;
  unreadByOperator: number;
}

export interface MessageSummary {
  id: string;
  sessionId: string;
  content: string;
  authorType: string;
  authorId: string | null;
  isInternal: boolean;
  createdAt: Date;
}

export interface AppointmentSummary {
  id: string;
  specialistName: string;
  visitorName: string;
  startsAt: string;
  status: string;
}

// ── Operator connections (tenantId → Set<WebSocket>) ─────────────────────────

const operatorConnections = new Map<string, Set<RealtimeSocket>>();

export function registerOperator(tenantId: string, ws: RealtimeSocket): void {
  if (!operatorConnections.has(tenantId)) {
    operatorConnections.set(tenantId, new Set());
  }
  operatorConnections.get(tenantId)!.add(ws);
}

export function unregisterOperator(tenantId: string, ws: RealtimeSocket): void {
  operatorConnections.get(tenantId)?.delete(ws);
}

// ── Visitor connections (sessionId → Set<WebSocket>) ─────────────────────────

const visitorConnections = new Map<string, Set<RealtimeSocket>>();

export function registerVisitor(sessionId: string, ws: RealtimeSocket): void {
  if (!visitorConnections.has(sessionId)) {
    visitorConnections.set(sessionId, new Set());
  }
  visitorConnections.get(sessionId)!.add(ws);
}

export function unregisterVisitor(sessionId: string, ws: RealtimeSocket): void {
  visitorConnections.get(sessionId)?.delete(ws);
  if (visitorConnections.get(sessionId)?.size === 0) {
    visitorConnections.delete(sessionId);
  }
}

// ── Broadcasting ─────────────────────────────────────────────────────────────

export function publishToOperators(tenantId: string, event: HubEvent): void {
  const sockets = operatorConnections.get(tenantId);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === OPEN_WEBSOCKET) {
      ws.send(payload);
    }
  }
}

export function publishToVisitor(sessionId: string, event: HubEvent): void {
  const sockets = visitorConnections.get(sessionId);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === OPEN_WEBSOCKET) {
      ws.send(payload);
    }
  }
}

/** Send event to both operators (by tenantId) and the specific visitor. */
export function publishToAll(tenantId: string, sessionId: string, event: HubEvent): void {
  publishToOperators(tenantId, event);
  publishToVisitor(sessionId, event);
}
