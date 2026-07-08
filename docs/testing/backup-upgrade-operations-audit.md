# Backup, Upgrade, and Operations Audit

## Scenarios Checked

| Scenario                                     | Result                                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh Docker Compose install                 | Compose starts PostgreSQL, Qdrant, backend, and nginx. Backend entrypoint runs `prisma migrate deploy`, then the idempotent seed, then starts the HTTP server.                |
| Backup before upgrade                        | PostgreSQL needs a logical `pg_dump`; Qdrant and uploads are named volumes. Existing docs did not explain project-specific volume names or backup set consistency.            |
| Upgrade between tags/images                  | Startup applies Prisma migrations before serving. Existing docs did not include config validation, release-note review, smoke checks, or migration failure diagnosis.         |
| PostgreSQL restore                           | Restore is intentionally destructive to database state and should run with backend/nginx stopped. Existing docs did not provide restore commands.                             |
| Qdrant restore                               | Qdrant stores derived vector collections keyed from PostgreSQL chunk metadata. Existing docs backed it up but did not explain restore ordering or mismatch behavior.          |
| Upload preservation                          | Uploads include knowledge files and public assets under `/app/apps/backend/uploads`. Existing docs backed it up but did not explain restore impact.                           |
| Failed migration/startup/readiness diagnosis | Health and readiness are separate. Readiness checks PostgreSQL and Qdrant; migration and seed failures happen before HTTP startup. Existing docs only had brief log guidance. |
| Rollback after failed upgrade                | App rollback is safe only if the old backend is compatible with the current schema. Existing docs mentioned forward-only migrations but lacked concrete sequencing.           |

## Fixes Made

- Replaced `docs/upgrade.md` with a concrete Docker Compose runbook covering fresh install,
  backup, upgrade, PostgreSQL restore, Qdrant/uploads restore, diagnosis, and rollback.
- Documented default persistent volumes and the data each contains:
  `echosupport_postgres_data`, `echosupport_qdrant_data`, and
  `echosupport_uploads_data`.
- Updated production security guidance to link operators to the exact backup/restore
  runbook and to call out custom Compose project volume names.
- Updated getting-started guidance to point production operators at restore testing before
  the first upgrade.

## Verification

Run for this documentation-only change:

```bash
pnpm check:release
pnpm format
pnpm lint
pnpm typecheck
env POSTGRES_PASSWORD=test-postgres-password \
  JWT_SECRET=test-jwt-secret-at-least-32-characters \
  MASTER_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  CRON_SECRET=test-cron-secret-at-least-32-characters \
  ADMIN_EMAIL=admin@example.test \
  ADMIN_PASSWORD=test-admin-password \
  docker compose config --quiet
git diff --check
```

The Docker Compose config check uses temporary test-only values and does not start
containers or touch volumes.

`pnpm test:coverage`, `pnpm build`, and live smoke checks were not run because no
application code or scripts changed and no Docker stack was started.

## Remaining Risks and Follow-ups

- Restore commands were documented but not exercised against a disposable Docker stack in
  this audit. A future release gate should perform a full backup and restore drill using a
  temporary Compose project and temporary volumes.
- Qdrant data is currently backed up at the volume level. For larger installations, evaluate
  Qdrant snapshots and retention policies.
- There is no automated pre-upgrade migration compatibility check beyond
  `prisma migrate deploy` during backend startup.
- Rollback after a partially successful upgrade remains an operational decision because
  writes accepted after the backup point can make PostgreSQL, Qdrant, and uploads diverge.
