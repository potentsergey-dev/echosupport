# Security and Production Hardening Audit

Date: 2026-07-08
Branch: `security-production-hardening-audit`

## Scenarios Checked

- Docker Compose install path: clone, copy `.env.example`, replace secrets, start stack,
  wait for backend health, open `/admin`.
- Production environment parsing: required database URL, JWT secret, encryption key,
  cron secret, public URL, admin CORS origins, upload limit, and provider keys.
- Browser origin policy: protected auth/admin/operator routes, non-browser API clients,
  widget/public session creation, and WebSocket origin enforcement.
- Public route boundaries: public session creation, public message streaming, STT upload,
  CSAT, agent public keys, and per-agent allowed origins.
- Rate limits: global Fastify rate limit, login limit, public session/message/STT route
  limits, and visitor-level abuse checks.
- Upload handling: document MIME allowlist, empty-file rejection, configured max document
  size, STT MIME allowlist, empty-audio rejection, and STT size limit.
- Error and logging behavior: generic 500 responses, sanitized readiness dependency
  failures, sanitized public provider failures, and provider error logging server-side.
- Deployment surfaces: Dockerfile, Compose required variables, nginx proxy settings,
  backend entrypoint migration/seed/start sequence, healthcheck, and persistent volumes.
- Operator journey: `.env` setup, allowed origins/provider key setup, reverse proxy/TLS,
  readiness diagnosis, backup/upgrade, and common production errors.

## Fixes Made

- Added explicit environment validation helpers and tests for production-critical values.
- Rejected copied example placeholders for `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`, and
  `CRON_SECRET` at backend startup.
- Required `MASTER_ENCRYPTION_KEY` to be exactly 64 hexadecimal characters, not just any
  64-character string.
- Rejected wildcard, empty, malformed, and path-based `ADMIN_CORS_ORIGINS`.
- Normalized admin origin comparisons so trailing slashes in trusted origins behave as
  operators expect.
- Changed the production container to run as the non-root `node` user and assigned upload
  directory ownership explicitly.
- Added `docs/production-security.md` with secrets, CORS, proxy/TLS, backup/upgrade,
  readiness, and exposure guidance.
- Updated `.env.example`, `docs/getting-started.md`, `docs/configuration.md`, and
  `SECURITY.md` to document the new validation and production checklist.

## Verification Commands

Run from the repository root:

```bash
pnpm check:release
pnpm format
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm --filter @echosupport/backend test -- src/__tests__/env.test.ts src/__tests__/origin-policy.test.ts
pnpm build
docker compose config --quiet
git diff --check
```

Use temporary test-only values for Compose validation if `.env` is absent:

```bash
POSTGRES_PASSWORD=test-postgres-password \
JWT_SECRET=test-jwt-secret-at-least-32-random-characters \
MASTER_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
CRON_SECRET=test-cron-secret-at-least-32-random-characters \
ADMIN_EMAIL=owner@example.com \
ADMIN_PASSWORD=test-admin-password-at-least-12 \
docker compose config --quiet
```

## Remaining Risks and Follow-Ups

- CORS is intentionally permissive for public widget routes; sensitive public actions still
  require agent public keys and per-agent allowed origins. A future route-aware CORS policy
  could reduce reflected CORS headers for non-public routes.
- JWTs are returned to the admin SPA and stored client-side by the frontend. A future move
  to secure, same-site HTTP-only cookies would reduce token exposure from XSS but requires
  a broader auth migration.
- The backend disables CSP because widget embedding is cross-origin. Operators should add
  environment-specific CSP at their reverse proxy or CDN.
- Nginx `client_max_body_size` is static at `50m`; operators who raise
  `MAX_DOCUMENT_SIZE_MB` must update the reverse proxy limit as well.
- Compose includes local PostgreSQL and Qdrant for convenience. Production operators with
  stricter availability requirements should use managed or externally backed services and
  tested restore procedures.
