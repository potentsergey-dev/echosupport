# Install/use readiness matrix

| Step               | User action / command                                           | Expected result                                  |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------ |
| Configure env      | `cp .env.example .env`, fill required `replace-with-...` values | Compose can render without missing variables     |
| Start stack        | `docker compose up -d --build`                                  | `postgres`, `qdrant`, `backend`, `nginx` running |
| Check services     | `docker compose ps`                                             | Backend and Postgres are healthy                 |
| Readiness endpoint | `curl http://localhost:8080/api/v1/ready`                       | HTTP 200 with `{"status":"ready", ...}`          |
| Admin app          | Open `http://localhost:8080/admin`                              | Login screen loads                               |
| First admin login  | Use `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`              | Agent list/settings are reachable                |
| Widget assets      | Open `http://localhost:8080/widget.js` and `/embed.js`          | JavaScript assets load                           |
| Widget demo/dev    | `pnpm --filter @echosupport/widget dev`, open the Vite demo URL | Demo page loads after setting a real agent key   |
| Automated smoke    | `SMOKE_BASE_URL=http://localhost:8080 pnpm smoke:install`       | Health, readiness, admin shell, assets pass      |
| Optional session   | Add `SMOKE_AGENT_KEY=pk_...` to the smoke command               | Public session creation returns a session id     |

Minimum first success for release readiness is: a fresh Docker Compose stack reaches `/api/v1/ready`,
the admin app opens, the initial owner can sign in, widget assets are served, and deterministic
route-level tests cover public session/message behavior without requiring real AI provider calls.

Automated checks are `node scripts/smoke-install-readiness.mjs` for a running stack and
`pnpm --filter @echosupport/backend test:integration` for deterministic public chat/session flow.
