# Production Security Checklist

Use this checklist before exposing EchoSupport to the Internet.

## Secrets

- Copy `.env.example` to `.env` and replace every `replace-with-*` value.
- Generate `JWT_SECRET` and `CRON_SECRET` with at least 32 random characters:

```bash
openssl rand -base64 48
```

- Generate `MASTER_ENCRYPTION_KEY` as exactly 64 hexadecimal characters:

```bash
openssl rand -hex 32
```

- Store `.env` and `MASTER_ENCRYPTION_KEY` in a password manager or secret store.
  Changing `MASTER_ENCRYPTION_KEY` makes existing encrypted agent provider keys unreadable.
- Never commit `.env`, provider API keys, database dumps, uploaded files, Qdrant data,
  support transcripts, or screenshots containing customer data.

## Origins, CORS, and Public Routes

- Set `PUBLIC_BASE_URL` to the public HTTPS URL users load, for example
  `https://support.example.com`.
- Set `ADMIN_CORS_ORIGINS` to the exact HTTPS browser origins allowed to use the admin,
  operator, and auth APIs. Use comma-separated origins only, with no paths:

```env
ADMIN_CORS_ORIGINS=https://support.example.com,https://admin.example.com
```

- Do not use `*` for `ADMIN_CORS_ORIGINS`. Startup rejects wildcard, empty, malformed,
  and path-based admin origins.
- Widget/public session routes still require each agent public key and the agent's allowed
  website origins. Configure those origins on the agent Profile tab.

## Reverse Proxy and TLS

- Terminate TLS at nginx, Caddy, Traefik, a load balancer, or another reverse proxy.
- Forward `Host`, `X-Forwarded-For`, `X-Real-IP`, and `X-Forwarded-Proto`.
- Keep request body limits aligned with `MAX_DOCUMENT_SIZE_MB`. The included nginx config
  allows `50m`, matching the default.
- Do not expose PostgreSQL, Qdrant, or the backend container port directly to the public
  Internet. Expose only the reverse proxy.
- Add environment-specific CSP at your outer proxy/CDN if you need a stricter policy than
  the default backend headers. The backend disables CSP so the widget can be embedded.

## Backups and Upgrades

- Back up PostgreSQL, Qdrant, uploads, and `.env` before upgrades.
- Verify restore procedures on a non-production host.
- Run `docker compose config --quiet` before rollout.
- After upgrade, check:

```bash
docker compose ps
curl -fsS https://support.example.com/api/v1/health
curl -fsS https://support.example.com/api/v1/ready
docker compose logs --tail=100 backend
```

## Readiness and Troubleshooting

- `/api/v1/health` checks that the HTTP process is alive.
- `/api/v1/ready` checks PostgreSQL and Qdrant and returns sanitized component status.
- If startup fails with `Invalid environment variables`, replace placeholders, fix
  `MASTER_ENCRYPTION_KEY`, and ensure `ADMIN_CORS_ORIGINS` contains only trusted origins.
- If `/ready` returns `503`, inspect `docker compose logs backend postgres qdrant`.
- If admin login fails from a browser, confirm the browser origin is listed in
  `ADMIN_CORS_ORIGINS`.
- If widget calls fail with `Origin not allowed`, add the page origin to the selected
  agent's allowed origins.
