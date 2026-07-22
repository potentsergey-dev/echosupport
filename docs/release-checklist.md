# Release Checklist

Use this checklist before publishing a GitHub release or handing a build to users. The goal is to confirm that EchoSupport can be installed, configured, tested, and upgraded without reading source code.

## 1. Version And Source

- Confirm `package.json` and all workspace package versions match the intended release version.
- Confirm the working tree is clean.
- Confirm release notes mention database migrations, user-visible changes, and upgrade notes.
- Confirm `.env.example`, `docs/configuration.md`, and Docker Compose describe every required runtime variable.
- Confirm `docs/demo-to-main-release.md` matches the current repository layout and transfer method.

## 2. Automated Checks

Run from a clean checkout:

```bash
pnpm install --frozen-lockfile
pnpm --filter @echosupport/backend db:generate
pnpm -r typecheck
pnpm --filter @echosupport/backend test
pnpm build:prod
pnpm check:release
```

Expected result: every command completes without errors.

## 3. Fresh Docker Install

Start a fresh stack with production-like secrets:

```bash
cp .env.example .env
# Replace every required replace-with-* value.
docker compose up -d --build
curl -i http://localhost:8080/api/v1/ready
```

Expected result:

- Backend, PostgreSQL, Qdrant, and nginx containers are healthy.
- `/api/v1/ready` returns `200` with database and Qdrant `up`.
- Initial admin login works with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## 4. Lite Acceptance

Set `APP_EDITION=lite`, rebuild, and verify:

- Admin shows only Profile, API keys, Knowledge base, and Embed.
- OpenRouter chat and embedding keys can be saved and remain masked.
- A document can be uploaded and indexed.
- The widget answers from indexed knowledge.
- `?chat=open&source=tiktok` opens the widget automatically.
- On phone/tablet width, the widget opens full-screen.
- `Powered by EchoSupport` is visible.

## 5. PRO Acceptance

Set `APP_EDITION=pro`, rebuild, and verify:

- Inbox, Appointments, Specialists, Services, and CSAT are visible.
- Working mode hides settings and leaves operator work screens available.
- A specialist can be created with working hours.
- A normal service allows only one active appointment for the same specialist/time.
- A group service shows `Групповое занятие` and allows bookings up to `Количество мест`.
- A filled group returns a clear error instead of creating one more appointment.
- Week and day appointment views show expected records.
- AI answers normal knowledge questions without immediately handing off to an operator.
- Visitor handoff, manual operator takeover, return-to-agent, and resolve flows work.
- Browser in-app banner, sound, tab title, and HTTPS system notification setup behave as documented.
- CSAT appears after ending a chat and is visible in the CSAT page.

## 6. Security And Operations

- Use HTTPS for public deployments and browser system notifications.
- Set exact `PUBLIC_BASE_URL` and `ADMIN_CORS_ORIGINS` values.
- Store `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`, provider keys, and database passwords outside source control.
- Confirm backups exist for PostgreSQL, Qdrant, and uploads.
- Test restore on a non-production host before upgrading a production install.
- Review `docs/production-security.md` and `docs/upgrade.md`.

## 7. Final Smoke Test

Run the VPS checklist in `docs/testing/vps-lite-pro-smoke-test.md` against the release candidate.

The release is ready only when Lite, PRO, widget launch links, booking, handoff, notifications, CSAT, backup, and upgrade checks all pass without release-blocking defects.
