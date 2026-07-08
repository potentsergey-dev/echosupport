# Configuration

| Variable                       | Required    | Default                 | Purpose                                        |
| ------------------------------ | ----------- | ----------------------- | ---------------------------------------------- |
| `POSTGRES_DB`                  | Docker      | `echosupport`           | PostgreSQL database                            |
| `POSTGRES_USER`                | Docker      | `echosupport`           | PostgreSQL user                                |
| `POSTGRES_PASSWORD`            | Yes         | —                       | PostgreSQL password                            |
| `NODE_ENV`                     | Internal    | `production`            | Backend runtime mode                           |
| `HOST`                         | Internal    | `0.0.0.0`               | Backend listen address                         |
| `PORT`                         | Internal    | `3000`                  | Backend listen port                            |
| `DATABASE_URL`                 | Non-Compose | —                       | PostgreSQL connection URL                      |
| `DIRECT_URL`                   | No          | `DATABASE_URL`          | Direct URL used by migrations                  |
| `JWT_SECRET`                   | Yes         | —                       | JWT signing secret, at least 32 characters     |
| `MASTER_ENCRYPTION_KEY`        | Yes         | —                       | 64 hex characters; encrypts agent secrets      |
| `CRON_SECRET`                  | Docker      | —                       | Internal cron authentication secret            |
| `ADMIN_EMAIL`                  | Docker/seed | —                       | Initial owner email                            |
| `ADMIN_PASSWORD`               | Docker/seed | —                       | Initial owner password, at least 12 characters |
| `PUBLIC_BASE_URL`              | Production  | `APP_URL`               | Public URL used by embed snippets and uploads  |
| `APP_URL`                      | Yes         | `http://localhost:3000` | Backend identity and fallback public URL       |
| `ADMIN_CORS_ORIGINS`           | Yes         | `http://localhost:5173` | Comma-separated trusted admin origins          |
| `UPLOADS_DIR`                  | No          | `./uploads`             | Persistent uploads directory                   |
| `QDRANT_URL`                   | Yes         | `http://localhost:6333` | Qdrant API URL                                 |
| `QDRANT_API_KEY`               | Cloud only  | —                       | Qdrant Cloud API key                           |
| `OPENROUTER_API_KEY`           | Usually     | empty                   | Default chat completion key                    |
| `OPENROUTER_EMBEDDING_API_KEY` | No          | empty                   | Dedicated OpenRouter embeddings key            |
| `OPENROUTER_BASE_URL`          | No          | OpenRouter API          | OpenRouter-compatible API base URL             |
| `OPENAI_API_KEY`               | No          | empty                   | OpenAI embeddings/Whisper key                  |
| `DEEPGRAM_API_KEY`             | No          | empty                   | Deepgram speech-to-text key                    |
| `MAX_DOCUMENT_SIZE_MB`         | No          | `50`                    | Maximum uploaded document size                 |
| `HTTP_PORT`                    | Docker      | `8080`                  | Host HTTP port                                 |

Agent-specific provider keys saved in the admin panel are encrypted with
`MASTER_ENCRYPTION_KEY` and override global provider keys.

Knowledge indexing requires an embeddings-capable key. EchoSupport checks agent-specific
OpenAI embedding, OpenRouter embedding, and OpenAI keys first, then global
`OPENAI_API_KEY`, `OPENROUTER_EMBEDDING_API_KEY`, and `OPENROUTER_API_KEY`. If none are set,
indexing fails before contacting Qdrant and the Knowledge base tab shows the item-level error.

Use global provider keys in `.env` when every agent can share the same provider account.
Use the agent API keys tab when a tenant or agent needs separate billing, limits, or
rotation. Empty agent key fields do not erase existing encrypted keys.

Changing `MASTER_ENCRYPTION_KEY` makes existing encrypted keys unreadable. Back it up in
a password manager.

## Smoke-check variables

These variables are used only by `pnpm smoke:install` and are not backend runtime
configuration:

| Variable           | Required | Default                 | Purpose                                  |
| ------------------ | -------- | ----------------------- | ---------------------------------------- |
| `SMOKE_BASE_URL`   | No       | `http://localhost:8080` | Running stack URL to check               |
| `SMOKE_TIMEOUT_MS` | No       | `10000`                 | Per-request timeout for smoke checks     |
| `SMOKE_AGENT_KEY`  | No       | —                       | Also create a public session if provided |
