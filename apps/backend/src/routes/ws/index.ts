/**
 * WebSocket routes:
 *   /ws/operator — authenticated operators subscribe to their tenant's session events
 *   /ws/visitor  — visitors receive operator messages / typing indicators in real-time
 */

import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../db/prisma.js';
import {
  registerOperator,
  unregisterOperator,
  registerVisitor,
  unregisterVisitor,
} from '../../services/realtime-hub.js';
import { env } from '../../config/env.js';
import { isAdminOriginAllowed, isOriginAllowed } from '../../services/origin-policy.js';

const OPERATOR_ROLES = ['OWNER', 'ADMIN', 'OPERATOR'];

type RawData = string | Buffer | ArrayBuffer | Buffer[];

interface RouteSocket {
  readyState: number;
  send(payload: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (raw: RawData) => void): void;
  on(event: 'close', listener: () => void): void;
}

function rawDataToString(raw: RawData): string {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Buffer) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw as ArrayBuffer).toString('utf8');
}

const wsRoutes: FastifyPluginAsync = async (fastify) => {
  // ── /ws/operator ─────────────────────────────────────────────────────────
  // Authenticated operators: receive real-time events for their tenant.
  // Auth: JWT via Authorization header or ?token= query param.
  fastify.get('/ws/operator', { websocket: true }, async (socket: RouteSocket, req) => {
    if (!isAdminOriginAllowed(req.headers.origin, env.ADMIN_CORS_ORIGINS)) {
      socket.close(1008, 'Origin not allowed');
      return;
    }
    // Authenticate via JWT — support ?token= for WS (browser can't set headers)
    let tenantId: string;
    let role: string;
    try {
      const queryToken = (req.query as Record<string, string | undefined>)['token'];
      if (queryToken && !req.headers['authorization']) {
        req.headers['authorization'] = `Bearer ${queryToken}`;
      }
      await req.jwtVerify();
      tenantId = req.user.tenantId;
      role = req.user.role;
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
      socket.close(1008, 'Unauthorized');
      return;
    }

    if (!OPERATOR_ROLES.includes(role)) {
      socket.send(JSON.stringify({ type: 'error', message: 'Forbidden' }));
      socket.close(1008, 'Forbidden');
      return;
    }

    registerOperator(tenantId, socket);

    socket.send(JSON.stringify({ type: 'connected', tenantId }));

    socket.on('message', (raw: RawData) => {
      // Operators may send ping or typing events
      try {
        const msg = JSON.parse(rawDataToString(raw)) as Record<string, unknown>;
        if (msg['type'] === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    socket.on('close', () => {
      unregisterOperator(tenantId, socket);
    });
  });

  // ── /ws/visitor ───────────────────────────────────────────────────────────
  // Visitor channel: authenticated via sessionId + agentKey query params.
  // Visitor receives operator messages and typing indicators.
  fastify.get('/ws/visitor', { websocket: true }, async (socket: RouteSocket, req) => {
    const query = req.query as Record<string, string | undefined>;
    const sessionId = query['sessionId'];
    const agentKey = query['agentKey'];

    if (!sessionId || !agentKey) {
      socket.send(JSON.stringify({ type: 'error', message: 'Missing sessionId or agentKey' }));
      socket.close(1008, 'Bad Request');
      return;
    }

    // Validate session belongs to this agent
    const session = await prisma.session.findFirst({
      where: { id: sessionId, agent: { publicKey: agentKey } },
      select: { id: true, agentId: true, agent: { select: { allowedOrigins: true } } },
    });

    if (!session) {
      socket.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
      socket.close(1008, 'Not Found');
      return;
    }
    if (!isOriginAllowed(req.headers.origin, session.agent.allowedOrigins)) {
      socket.close(1008, 'Origin not allowed');
      return;
    }

    registerVisitor(sessionId, socket);

    socket.send(JSON.stringify({ type: 'connected', sessionId }));

    socket.on('message', (raw: RawData) => {
      try {
        const msg = JSON.parse(rawDataToString(raw)) as Record<string, unknown>;
        if (msg['type'] === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // ignore
      }
    });

    socket.on('close', () => {
      unregisterVisitor(sessionId, socket);
    });
  });
};

export default wsRoutes;
