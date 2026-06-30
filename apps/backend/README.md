# @echosupport/backend

Fastify backend for EchoSupport.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- PostgreSQL (Neon or local)

## Setup

1. Copy the root `.env.example` to `apps/backend/.env` and fill in `DATABASE_URL`, `JWT_SECRET`, and `MASTER_ENCRYPTION_KEY`.

```bash
cp ../../.env.example .env
```

2. Run database migrations:

```bash
pnpm db:migrate
```

3. Seed demo data (dev only):

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

## Demo credentials (after seed)

- **Email**: `owner@local.test`
- **Password**: `admin12345`
