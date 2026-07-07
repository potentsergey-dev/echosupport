# EchoSupport

Self-hosted AI customer-support platform with a website widget, RAG knowledge base,
human handoff, appointment booking, voice input, CSAT, and an operator inbox.

[![CI](https://github.com/potentsergey-dev/echosupport/actions/workflows/ci.yml/badge.svg)](https://github.com/potentsergey-dev/echosupport/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-green.svg)](https://nodejs.org/)

## Features

- Streaming AI answers powered by OpenRouter and your knowledge base
- Files and website indexing into Qdrant
- Embeddable Preact widget with voice input and quick replies
- Human handoff with a real-time operator inbox
- Specialists, services, and appointment booking
- CSAT reports and optional proactive prompts
- Multi-tenant admin panel and encrypted per-agent API keys
- Docker Compose deployment with PostgreSQL, Qdrant, nginx, migrations, and health checks

## Quick Start with Docker

Requirements: Docker Engine with Docker Compose v2 and 2 GB RAM. An OpenRouter API key is
needed for the first AI chat answer, but not for the install smoke.

```bash
git clone https://github.com/potentsergey-dev/echosupport.git
cd echosupport
cp .env.example .env
```

Edit `.env`: replace every `replace-with-...` value and set `ADMIN_EMAIL` and
`ADMIN_PASSWORD`. Set `OPENROUTER_API_KEY` now if you want chat answers immediately.
Generate secrets with:

```bash
openssl rand -base64 48   # JWT_SECRET and CRON_SECRET
openssl rand -hex 32      # MASTER_ENCRYPTION_KEY
```

Start EchoSupport:

```bash
docker compose up -d --build
docker compose ps
curl http://localhost:8080/api/v1/ready
```

Open <http://localhost:8080/admin> and sign in with the initial owner credentials
from `.env`. Migrations and the initial idempotent seed run automatically. The widget
assets are served from <http://localhost:8080/widget.js> and
<http://localhost:8080/embed.js>.

Run the user-facing install smoke against a running stack:

```bash
SMOKE_BASE_URL=http://localhost:8080 pnpm smoke:install
```

After login, open the Embed page for the demo agent, copy its public key into
`apps/widget/demo.html`, run `pnpm --filter @echosupport/widget dev`, and open the Vite
demo URL shown in the terminal. Chat answers require an OpenRouter key, either globally
in `.env` or saved on the agent.

> PostgreSQL passwords used inside `DATABASE_URL` must be URL-encoded. The provided
> Compose configuration constructs the URL from `POSTGRES_*`; avoid reserved URL
> characters in `POSTGRES_PASSWORD`, or provide an encoded connection URL when adapting
> the deployment.

## Documentation

- [Getting started](docs/getting-started.md)
- [Configuration reference](docs/configuration.md)
- [Create an agent and embed the widget](docs/agent-setup.md)
- [Upgrade and backup](docs/upgrade.md)
- [Install readiness matrix](docs/testing/install-readiness-matrix.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Architecture and design notes](plans/00-overview.md)

## Development

Requirements: Node.js 22.13+, pnpm 11.1.2+, PostgreSQL, and Qdrant.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm --filter @echosupport/backend db:generate
pnpm --filter @echosupport/backend db:migrate
pnpm --filter @echosupport/backend db:seed
pnpm --filter @echosupport/backend dev
```

Run the admin and widget dev servers in separate terminals:

```bash
pnpm --filter @echosupport/admin dev
pnpm --filter @echosupport/widget dev
```

Quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
```

## Project Structure

```text
apps/backend    Fastify API, Prisma schema, workers, and WebSockets
apps/admin      React admin and operator interface
apps/widget     Preact embeddable chat widget
packages/shared Shared TypeScript package
docker          Container entrypoint and nginx configuration
docs            User and operator documentation
plans           Architecture and historical design documents
```

## License

[MIT](LICENSE). You may self-host and modify EchoSupport. Third-party AI, speech, and
hosting providers have their own pricing and terms.
