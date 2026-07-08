# First-user journey audit

Date: 2026-07-08

Scope: fresh public GitHub user path after v1.0.2, using Docker Compose and test-only
secrets. No real AI, embeddings, STT, or other provider secrets were used. The Docker
smoke used project name `echosupport_first_user` and `HTTP_PORT=18080` to avoid colliding
with a normal local install.

## Checked path

1. Clone and enter the repository.
2. Copy `.env.example` to `.env`.
3. Replace required install values:
   - `POSTGRES_PASSWORD`
   - `JWT_SECRET`
   - `MASTER_ENCRYPTION_KEY`
   - `CRON_SECRET`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
4. Leave provider keys empty for the install smoke.
5. Run the Compose config check:

   ```bash
   docker compose --env-file /tmp/echosupport-first-user.env -p echosupport_first_user config --quiet
   ```

6. Start the stack with `docker compose up -d --build`.
7. Check `docker compose ps`.
8. Check `http://localhost:18080/api/v1/health` and `http://localhost:18080/api/v1/ready`.
9. Open `http://localhost:18080/admin`.
10. Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
11. Open the seeded `Demo Agent`.
12. Review Profile, Secrets, Knowledge, and Embed tabs.
13. Confirm `/widget.js` and `/embed.js` are served.
14. Run `SMOKE_BASE_URL=http://localhost:18080 pnpm smoke:install`.
15. For widget demo, run `pnpm --filter @echosupport/widget dev` and open
    `demo.html?agentKey=pk_...&apiBase=http://localhost:18080`.

## Passed

- The repository has a root `.env.example` aligned with Compose runtime variables.
- Docker Compose includes PostgreSQL, Qdrant, backend, nginx, migrations, seed, and health
  checks.
- The backend entrypoint deploys migrations and idempotently creates the initial owner and
  `Demo Agent`.
- Fresh Docker Compose build/start completed with test-only secrets and empty provider keys.
- `http://localhost:18080/api/v1/health` returned `{"status":"ok", ...}`.
- `http://localhost:18080/api/v1/ready` returned `{"status":"ready", ...}` with PostgreSQL
  and Qdrant checks up.
- First admin login succeeded for `first-user@example.test` with role `OWNER`.
- The seeded `Demo Agent` was reachable through the admin API and exposed a `pk_...` public
  key.
- `/api/v1/health`, `/api/v1/ready`, `/admin`, `/widget.js`, and `/embed.js` are covered by
  the install smoke script.
- `SMOKE_AGENT_KEY` extended the smoke check to public session creation successfully.

## Fixed in this audit

- Clarified that AI/STT provider keys are not required for install readiness or widget asset
  smoke checks.
- Added explicit secret generation commands to the getting-started guide.
- Clarified that the first Docker admin URL is `http://localhost:8080/admin` and the seeded
  `Demo Agent` is available after login.
- Updated widget demo instructions to use the Docker API base `http://localhost:8080`.
- Let `apps/widget/demo.html` accept `agentKey` and `apiBase` query parameters, so a new user
  can run the demo without editing the file.
- Changed `apps/widget/demo.html` to load Vite's source entry (`./src/index.ts`) in dev,
  instead of requiring a pre-existing `dist/widget.js` from a prior build.

## Follow-up

- `docker compose config --quiet` validates that required variables exist, but it cannot tell
  whether placeholder values were replaced. A future preflight script could fail fast on
  `replace-with-...` values before the user waits for image build/startup.
- The widget demo still requires manually copying an agent public key from the admin UI. A
  richer demo helper could print the first agent key after authenticated login, but that would
  be a product/tooling addition beyond this audit.
- Real chat answers, embeddings, web indexing, and voice input still need provider-specific
  keys and were intentionally not tested in this no-secret install scenario.
