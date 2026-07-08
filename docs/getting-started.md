# Getting Started

## 1. Prepare the server

Install Docker Engine and Docker Compose v2. Clone the repository and create the
environment file:

```bash
git clone https://github.com/potentsergey-dev/echosupport.git
cd echosupport
cp .env.example .env
```

## 2. Decide whether to add provider keys now

- You can complete install, readiness, admin login, and widget asset smoke checks without
  AI/STT provider keys.
- Create an OpenRouter key for chat completions when you are ready to test real answers.
- Create an OpenAI or OpenRouter embeddings key when you are ready to index knowledge.
- Optionally create a Deepgram key for voice transcription.
- Local Qdrant is included in Compose, so Qdrant Cloud is not required.

Never commit keys to Git or paste them into issues.

## 3. Configure secrets

Edit `.env`. Replace the database password, JWT secret, encryption key, cron secret,
initial owner credentials, and public URL. Startup rejects copied placeholder secrets and
invalid admin origins. `MASTER_ENCRYPTION_KEY` must remain unchanged after data has been
encrypted.

Useful generators:

```bash
openssl rand -base64 48   # JWT_SECRET and CRON_SECRET
openssl rand -hex 32      # MASTER_ENCRYPTION_KEY
```

## 4. Start

```bash
docker compose up -d --build
docker compose ps
curl http://localhost:8080/api/v1/health
curl http://localhost:8080/api/v1/ready
docker compose logs -f backend
```

The backend becomes healthy after migrations and seed complete. Open
`http://localhost:8080/admin`.

`ADMIN_PASSWORD` remains the source of truth for the initial owner account. Changing it
in `.env` and restarting the backend rotates that account's password.

## 5. Verify

Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. Compose automatically creates
a demo tenant, the initial owner, and a `Demo Agent`. Open that agent from the sidebar and
work through these tabs:

1. Profile: check the greeting, model, language, session TTL, and allowed website origins.
2. API keys: save provider keys only when you want real chat, embeddings, or speech-to-text.
3. Knowledge base: upload PDF, DOCX, TXT, MD, or HTML files, or add public `http`/`https`
   URL sources. Run indexing and wait for `INDEXED`; `FAILED` items show the error inline.
4. Embed: copy the widget code or the public agent key and test it on a page whose origin
   is listed in Profile.

The global pages in the sidebar cover operator work after launch: Inbox for handoff,
Specialists, Services, Appointments, and CSAT.

You can run the install smoke against the stack:

```bash
SMOKE_BASE_URL=http://localhost:8080 pnpm smoke:install
```

To smoke-test public session creation too, add an agent public key from the Embed page:

```bash
SMOKE_BASE_URL=http://localhost:8080 SMOKE_AGENT_KEY=pk_your_agent_key pnpm smoke:install
```

For the local widget demo, add `http://localhost:5173` to the agent's allowed origins on
the Profile tab. Then open the Embed tab, copy the public agent key, and run:

```bash
pnpm --filter @echosupport/widget dev
```

Then open the Vite URL printed in the terminal with the public key and Docker API base:

```text
http://localhost:5173/demo.html?agentKey=pk_your_agent_key&apiBase=http://localhost:8080
```

If you are testing against local backend dev instead of Docker, use
`apiBase=http://localhost:3000`.

For Internet deployment, terminate HTTPS at a reverse proxy and set `PUBLIC_BASE_URL`
and `ADMIN_CORS_ORIGINS` to the HTTPS URL. Work through
[Production Security Checklist](production-security.md) before exposing the app.
Before the first production upgrade, work through
[Upgrade, Backup, and Restore](upgrade.md) and test a restore on a non-production host.

## Troubleshooting

- `docker compose config` fails: check that every required value in `.env` has been
  replaced, especially `POSTGRES_PASSWORD`, `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`,
  `CRON_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
- Backend exits with `Invalid environment variables`: replace copied example secrets,
  ensure `MASTER_ENCRYPTION_KEY` is exactly 64 hex characters, and set
  `ADMIN_CORS_ORIGINS` to comma-separated trusted origins with no paths or wildcards.
- `/api/v1/ready` returns `503`: inspect `docker compose logs backend postgres qdrant`.
  The backend waits for migrations, PostgreSQL, and Qdrant.
- Backend logs show Prisma `P1000` after changing `POSTGRES_PASSWORD` or `POSTGRES_DB`:
  the existing `postgres_data` volume was initialized with the old credentials. Restore
  the old values, or back up data and run `docker compose down --volumes` before starting
  a fresh install.
- Login fails after changing `.env`: restart the backend; the seed step rotates the initial
  owner password from `ADMIN_PASSWORD`.
- Widget returns `Origin not allowed`: add the page origin on the agent Profile tab. Use the
  exact origin including scheme and port, for example `https://example.com` or
  `http://localhost:5173`; do not include a path. EchoSupport normalizes accidental trailing
  slashes and paths, but the scheme, host, and port must match the browser origin.
- Widget shows `Invalid agent key`: open the agent Embed tab and copy the public agent key
  again. Public keys start with `pk_`; provider API keys never go in the embed snippet.
- Widget shows `Failed to fetch` or stays unavailable: confirm the backend public URL in the
  snippet is reachable from the browser and that `/embed.js`, `/widget.js`, and
  `/api/v1/health` load from the same public base URL.
- Chat returns an LLM configuration error: set `OPENROUTER_API_KEY` or save an agent-specific
  OpenRouter key on the agent API keys tab.
- Voice input returns an STT configuration error: add a Deepgram key for the default STT
  provider, or switch the agent to Whisper and add an OpenAI key.
- Knowledge indexing fails with a provider-key message: add an OpenAI/OpenRouter embedding
  key globally or on the agent API keys tab. Chat keys alone are not enough unless they are
  also valid for embeddings.
- Uploaded files or URL sources do not affect answers yet: open the agent Knowledge base tab,
  run indexing, and check that files/sources move to `INDEXED`. Then test the public widget
  with a question that is directly covered by the indexed content.
