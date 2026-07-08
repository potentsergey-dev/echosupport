# Observability and Supportability Audit

Date: 2026-07-08
Branch: `observability-supportability-audit`

## Scenarios Checked

| Scenario                                   | Diagnostic path                                                   | Result                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| App does not start                         | `docker compose ps`, backend logs, env validation output          | Env validation already reports variable names without values; docs now list safe startup checks.                     |
| `/api/v1/ready` is not ready               | `curl /api/v1/ready`, backend/postgres/qdrant logs                | Readiness reports component status, latency, sanitized error class, and static hints.                                |
| PostgreSQL down                            | `checks.database=down`, `docker compose logs postgres backend`    | Static hint added without exposing `DATABASE_URL`.                                                                   |
| Qdrant down                                | `checks.qdrant=down`, `docker compose logs qdrant backend`        | Static hint added without exposing `QDRANT_URL` or `QDRANT_API_KEY`.                                                 |
| Admin cannot log in                        | Auth route, CORS hook, seed docs                                  | Docs now distinguish invalid credentials from `ADMIN_CORS_ORIGINS` origin failures and password rotation by restart. |
| Widget cannot create session               | Public session route, origin policy, smoke optional session check | Docs cover missing/invalid public key, allowed origins, and browser reachability of backend/widget assets.           |
| OpenRouter/provider key missing or invalid | Public chat/STT routes, operator suggested reply                  | Public errors remain sanitized; provider failure logs now use sanitized summaries.                                   |
| Indexing fails                             | Indexer, job runner, Knowledge base item errors                   | Persisted item/job errors now run through a sanitizer before display.                                                |
| WebSocket/operator inbox issues            | nginx config, websocket routes                                    | Docs call out proxy `Upgrade`/`Connection` headers and backend/nginx logs.                                           |
| Upload size/proxy/env mismatch             | multipart limit, nginx body size, configuration docs              | Docs now tell operators to align `MAX_DOCUMENT_SIZE_MB`, nginx, and outer proxy/CDN limits.                          |

## Fixes Made

- Added `apps/backend/src/services/error-sanitizer.ts` to redact common secret shapes from diagnostics.
- Sanitized indexing item errors and background job failure messages before saving them in PostgreSQL.
- Sanitized background retriever/job/cleanup console diagnostics.
- Sanitized provider failure logs for public chat/STT and operator suggested replies.
- Added Fastify/Pino redaction for `authorization`, `cookie`, `x-agent-key`, and `x-cron-secret` headers.
- Added readiness dependency hints for PostgreSQL and Qdrant without returning raw exception messages.
- Improved `scripts/smoke-install-readiness.mjs` to print sanitized readiness component details on failure.
- Expanded troubleshooting guidance in getting started, configuration, production security, and upgrade docs.

## Verification Commands

Run after changes:

```bash
pnpm check:release
pnpm format
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
git diff --check
```

Docker-only verification, if approved:

```bash
docker compose config --quiet
SMOKE_BASE_URL=http://localhost:8080 pnpm smoke:install
```

Use temporary test-only `.env` values and do not paste real provider keys into terminal
history or shared logs.

## Remaining Risks and Follow-ups

- Structured Fastify logs can still include non-secret operational metadata such as route,
  status code, latency, host, and remote address. Operators should review logs before
  sharing them publicly.
- Provider SDK errors vary by vendor. The sanitizer covers common key, token, credentialed
  URL, and long-token shapes, but future provider formats may need new patterns.
- Smoke script behavior is covered by manual command verification; it is not currently
  unit-tested because it is a top-level executable script.
- Docker Compose readiness and smoke checks require Docker approval in this environment.
