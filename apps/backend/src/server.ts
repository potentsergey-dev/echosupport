import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import websocket from '@fastify/websocket';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'node:fs';
import { env } from './config/env.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth/login.js';
import agentRoutes from './routes/admin/agents.js';
import documentRoutes from './routes/admin/documents.js';
import jobRoutes from './routes/admin/jobs.js';
import adminSessionRoutes from './routes/admin/sessions.js';
import businessHoursRoutes from './routes/admin/business-hours.js';
import specialistsRoutes from './routes/admin/specialists.js';
import servicesRoutes from './routes/admin/services.js';
import publicSessionRoutes from './routes/public/sessions.js';
import internalCronRoutes from './routes/internal/cron.js';
import operatorRoutes from './routes/operator/index.js';
import wsRoutes from './routes/ws/index.js';
import { startJobRunner } from './services/job-runner.js';
import { startCleanupRunner } from './services/cleanup.js';
import { startOperatorNotifier, stopOperatorNotifier } from './services/operator-notifier.js';
import { prisma } from './db/prisma.js';
import { isAdminOriginAllowed } from './services/origin-policy.js';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      ...(env.NODE_ENV !== 'production' && {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
    },
  });

  const adminOrigins = env.ADMIN_CORS_ORIGINS.split(',').map((o) => o.trim());

  await app.register(cors, {
    // Public widget routes need to accept any origin (per-agent allowedOrigins check is
    // done inside the route handler).  Admin routes get the whitelist.
    origin: (origin, cb) => {
      // No Origin header = same-origin or non-browser requests (Postman, curl) — allow.
      if (!origin) return cb(null, true);
      // Admin origins whitelist
      if (adminOrigins.includes(origin)) return cb(null, true);
      // Everything else is allowed; the public route validates allowedOrigins per-agent.
      cb(null, true);
    },
    credentials: true,
  });

  app.addHook('onRequest', async (req, reply) => {
    const protectedBrowserRoute = ['/api/v1/auth/', '/api/v1/admin/', '/api/v1/operator/'].some(
      (prefix) => req.url.startsWith(prefix),
    );
    if (
      protectedBrowserRoute &&
      !isAdminOriginAllowed(req.headers.origin, env.ADMIN_CORS_ORIGINS)
    ) {
      return reply.status(403).send({ error: 'Origin not allowed' });
    }
  });

  // Security headers — disable CSP here; set it at CDN/nginx level per environment.
  // crossOriginEmbedderPolicy disabled to allow the widget to be embedded cross-origin.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
  });

  await app.register(multipart, {
    limits: { fileSize: env.MAX_DOCUMENT_SIZE_MB * 1024 * 1024 },
  });

  // WebSocket support (must be registered before routes that use it)
  await app.register(websocket);

  // Auth plugin — adds fastify.authenticate decorator (must be before route plugins)
  await app.register(authPlugin);

  app.setErrorHandler((error: FastifyError, _req, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode ?? 500;
    void reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
    });
  });

  app.get('/api/v1/health', async (_req, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Auth routes (public)
  await app.register(authRoutes, { prefix: '/api/v1/auth' });

  // Admin routes (protected by JWT via preHandler hook)
  await app.register(agentRoutes, { prefix: '/api/v1/admin' });
  await app.register(documentRoutes, { prefix: '/api/v1/admin' });
  await app.register(jobRoutes, { prefix: '/api/v1/admin' });
  await app.register(adminSessionRoutes, { prefix: '/api/v1/admin' });
  await app.register(businessHoursRoutes, { prefix: '/api/v1/admin' });
  await app.register(specialistsRoutes, { prefix: '/api/v1/admin' });
  await app.register(servicesRoutes, { prefix: '/api/v1/admin' });

  // Public routes (widget / chat — authenticated via X-Agent-Key)
  await app.register(publicSessionRoutes, { prefix: '/api/v1/public' });

  // Operator routes (inbox, handoff, canned responses — requires JWT + operator role)
  await app.register(operatorRoutes, { prefix: '/api/v1/operator' });

  // WebSocket routes (/ws/operator, /ws/visitor)
  await app.register(wsRoutes, { prefix: '/api/v1' });

  // Internal routes (cron triggers etc. — protected by CRON_SECRET)
  await app.register(internalCronRoutes, { prefix: '/api/v1/internal' });

  // Start background job runner
  const jobRunner = startJobRunner();

  // Start periodic TTL cleanup for expired sessions (every 15 minutes)
  const cleanupRunner = startCleanupRunner();

  // Start operator notification outbox worker (every 10 seconds)
  void startOperatorNotifier();

  app.addHook('onClose', async () => {
    clearInterval(jobRunner);
    clearInterval(cleanupRunner);
    stopOperatorNotifier();
    await prisma.$disconnect();
  });

  // Serve static files (widget.js, embed.js) from apps/backend/public/
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.join(__dirname, '..', 'public');
  await app.register(staticFiles, {
    root: publicDir,
    prefix: '/',
    decorateReply: false,
  });

  // Serve uploaded files (avatars, documents) — path matches the URL built in agents.ts
  const uploadsDir = path.resolve(env.UPLOADS_DIR);
  fs.mkdirSync(uploadsDir, { recursive: true });
  await app.register(staticFiles, {
    root: uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Serve compiled admin SPA (only if built — skipped in dev)
  const adminDistDir = path.join(__dirname, '..', '..', 'admin', 'dist');
  const adminIndexPath = path.join(adminDistDir, 'index.html');
  const adminIndexHtml = fs.existsSync(adminIndexPath)
    ? fs.readFileSync(adminIndexPath, 'utf-8')
    : null;

  if (adminIndexHtml) {
    await app.register(staticFiles, {
      root: adminDistDir,
      prefix: '/admin/',
      decorateReply: false,
    });
  }

  // SPA fallback — any /admin/* URL that isn't a static asset returns index.html
  // so that React Router can handle client-side navigation on hard refresh.
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/admin') && adminIndexHtml) {
      return reply.type('text/html').send(adminIndexHtml);
    }
    return reply.status(404).send({ error: 'Not Found' });
  });

  return app;
}
