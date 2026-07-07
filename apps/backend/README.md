# @echosupport/backend

Fastify backend for EchoSupport.

## Prerequisites

- Node.js ≥ 22.13
- pnpm ≥ 11.1
- PostgreSQL (Neon or local)
- Qdrant for readiness and retrieval

## Setup

1. Copy `apps/backend/.env.example` to `apps/backend/.env` for local backend-only
   development, or use the root `.env.example` with Docker Compose.

```bash
cp apps/backend/.env.example apps/backend/.env
```

2. Fill `DATABASE_URL`, `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`, and provider keys as needed.

3. Run database migrations:

```bash
pnpm db:migrate
```

4. Seed demo data (dev only). The seed requires `ADMIN_EMAIL` and `ADMIN_PASSWORD`
   with at least 12 characters:

```bash
pnpm db:seed
```

## Development

```bash
pnpm dev
```

Server starts at `http://localhost:3000`.

## Health check

```bash
curl http://localhost:3000/api/v1/health
# {"status":"ok","timestamp":"2026-05-15T12:00:00.000Z"}
```

## Scripts

| Script                   | Description                        |
| ------------------------ | ---------------------------------- |
| `pnpm dev`               | Start dev server with hot reload   |
| `pnpm build`             | Compile TypeScript                 |
| `pnpm start`             | Run compiled output                |
| `pnpm typecheck`         | Type-check without emitting        |
| `pnpm db:migrate`        | Run Prisma migrations (dev)        |
| `pnpm db:migrate:deploy` | Run Prisma migrations (production) |
| `pnpm db:seed`           | Seed demo data                     |
| `pnpm db:studio`         | Open Prisma Studio                 |
| `pnpm test`              | Run unit tests                     |

## Demo credentials

The seed creates or updates the initial owner from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
