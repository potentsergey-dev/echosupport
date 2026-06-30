# Getting Started

## 1. Prepare the server

Install Docker Engine and Docker Compose v2. Clone the repository and create the
environment file:

```bash
git clone https://github.com/potentsergey-dev/echosupport.git
cd echosupport
cp .env.example .env
```

## 2. Obtain provider keys

- Create an OpenRouter key for chat completions.
- Optionally create an OpenAI or OpenRouter embeddings key.
- Optionally create a Deepgram key for voice transcription.
- Local Qdrant is included in Compose, so Qdrant Cloud is not required.

Never commit keys to Git or paste them into issues.

## 3. Configure secrets

Edit `.env`. Replace the database password, JWT secret, encryption key, cron secret,
initial owner credentials, and public URL. `MASTER_ENCRYPTION_KEY` must remain unchanged
after data has been encrypted.

## 4. Start

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

The backend becomes healthy after migrations and seed complete. Open
`http://localhost:8080/admin`.

`ADMIN_PASSWORD` remains the source of truth for the initial owner account. Changing it
in `.env` and restarting the backend rotates that account's password.

## 5. Verify

Sign in, create or edit the demo agent, save provider keys, add a document, wait for
indexing, then open the Embed page. Test the snippet on a page whose origin is listed in
the agent's allowed origins.

For Internet deployment, terminate HTTPS at a reverse proxy and set
`PUBLIC_BASE_URL` and `ADMIN_CORS_ORIGINS` to the HTTPS URL.
