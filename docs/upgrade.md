# Upgrade, Backup, and Restore

Use this runbook for Docker Compose installations. It avoids destructive commands in the
normal backup path and calls out the points where a restore intentionally overwrites data.

The default Compose project is `echosupport`, so named volumes are usually:

| Volume                      | Mounted path                | Contains                                                                            |
| --------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| `echosupport_postgres_data` | `/var/lib/postgresql/data`  | PostgreSQL database files. Back up with `pg_dump`, not by copying this live volume. |
| `echosupport_qdrant_data`   | `/qdrant/storage`           | Qdrant vector collections derived from indexed knowledge chunks.                    |
| `echosupport_uploads_data`  | `/app/apps/backend/uploads` | Uploaded knowledge files and public upload assets such as avatars.                  |

If you start Compose with `-p` or `COMPOSE_PROJECT_NAME`, replace `echosupport` in the
volume names with that project name. Confirm the actual names before backup or restore:

```bash
docker compose config --volumes
docker volume ls --filter name=echosupport
```

Store `.env` separately in a password manager or secret store. Keep
`MASTER_ENCRYPTION_KEY` unchanged across upgrades and restores; changing it makes existing
encrypted agent provider keys unreadable.

## Fresh Install

```bash
cp .env.example .env
# Edit .env and replace every placeholder secret.
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:8080/api/v1/health
curl -fsS http://localhost:8080/api/v1/ready
SMOKE_BASE_URL=http://localhost:8080 pnpm smoke:install
```

The backend entrypoint runs `prisma migrate deploy`, then the idempotent seed, then starts
the HTTP server. The container does not become healthy until `/api/v1/ready` can reach
PostgreSQL and Qdrant.

## Backup Before Upgrade

Run backups from the repository directory on the Docker host. These commands write backup
files under `./backups/<timestamp>/`.

```bash
set -eu
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-echosupport}"
backup_dir="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"

docker compose exec -T postgres sh -c \
  'pg_dump --format=custom --no-owner --username "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$backup_dir/postgres.dump"

docker run --rm \
  -v "${COMPOSE_PROJECT_NAME}_qdrant_data:/data:ro" \
  -v "$PWD/$backup_dir:/backup" \
  alpine sh -c 'tar czf /backup/qdrant-data.tgz -C /data .'

docker run --rm \
  -v "${COMPOSE_PROJECT_NAME}_uploads_data:/data:ro" \
  -v "$PWD/$backup_dir:/backup" \
  alpine sh -c 'tar czf /backup/uploads-data.tgz -C /data .'

cp .env "$backup_dir/env.backup"
sha256sum "$backup_dir"/* > "$backup_dir/SHA256SUMS"
```

Keep the PostgreSQL dump, Qdrant archive, uploads archive, `.env`, and checksum file
together. Do not commit or share them; they may contain customer data, transcripts,
uploaded documents, provider credentials, and encrypted secrets.

Test restores on a non-production host before relying on backups for an upgrade window.

## Upgrade

1. Read the release notes and check whether the target release includes database
   migrations.
2. Back up PostgreSQL, Qdrant, uploads, and `.env` with the commands above.
3. Validate configuration before changing containers:

```bash
docker compose config --quiet
```

4. Move to the target version and rebuild or pull the image you deploy:

```bash
git fetch --tags
git checkout <target-tag>
docker compose build --pull
docker compose up -d
```

5. Watch migration, seed, startup, and readiness:

```bash
docker compose ps
docker compose logs --tail=200 backend
curl -fsS http://localhost:8080/api/v1/health
curl -fsS http://localhost:8080/api/v1/ready
SMOKE_BASE_URL=http://localhost:8080 pnpm smoke:install
```

For an Internet deployment, replace `http://localhost:8080` with `PUBLIC_BASE_URL`.

## Restore PostgreSQL

Restoring PostgreSQL overwrites database state. Stop the app first so no requests write
while the dump is being restored:

```bash
docker compose stop nginx backend
docker compose exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  < backups/<timestamp>/postgres.dump
docker compose up -d backend nginx
docker compose logs --tail=200 backend
curl -fsS http://localhost:8080/api/v1/ready
```

Use this for rollback after a failed migration only when you intend to return the database
to the pre-upgrade backup point. Any conversations, configuration changes, uploaded files,
or indexed content created after the backup may no longer match the restored database.

## Restore Qdrant and Uploads

Qdrant contains derived vector data for knowledge search. Uploads contain source files and
public upload assets referenced by PostgreSQL rows. Restore them from the same backup set
as PostgreSQL whenever possible.

For a disaster restore into a new host or empty Compose project:

```bash
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-echosupport}"
cp backups/<timestamp>/env.backup .env

docker volume create "${COMPOSE_PROJECT_NAME}_qdrant_data"
docker volume create "${COMPOSE_PROJECT_NAME}_uploads_data"

docker run --rm \
  -v "${COMPOSE_PROJECT_NAME}_qdrant_data:/data" \
  -v "$PWD/backups/<timestamp>:/backup:ro" \
  alpine sh -c 'tar xzf /backup/qdrant-data.tgz -C /data'

docker run --rm \
  -v "${COMPOSE_PROJECT_NAME}_uploads_data:/data" \
  -v "$PWD/backups/<timestamp>:/backup:ro" \
  alpine sh -c 'tar xzf /backup/uploads-data.tgz -C /data'

docker compose up -d postgres
docker compose exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  < backups/<timestamp>/postgres.dump
docker compose up -d
```

For an existing production host, first take a fresh backup of the current volumes and
database, then restore during a maintenance window. Avoid extracting a Qdrant or uploads
archive over a live service; stop `backend`, `nginx`, and `qdrant` first.

If PostgreSQL is restored without matching Qdrant data, knowledge answers may miss indexed
content until documents and URL sources are reindexed. If uploads are missing, file-backed
knowledge sources and avatar URLs can break even when PostgreSQL rows still exist.

## Diagnose Failed Startup or Readiness

```bash
docker compose ps
docker compose logs --tail=200 backend
docker compose logs --tail=100 postgres qdrant
curl -fsS http://localhost:8080/api/v1/health
curl -fsS http://localhost:8080/api/v1/ready
```

Common signals:

- `prisma migrate deploy` failure: the backend exits before serving traffic. Keep the
  pre-upgrade backup and inspect the migration error before retrying.
- Seed failure: check `ADMIN_EMAIL` and `ADMIN_PASSWORD`; the seed requires a password of
  at least 12 characters.
- PostgreSQL `P1000` after changing `POSTGRES_PASSWORD` or `POSTGRES_DB`: the existing
  PostgreSQL volume was initialized with the old credentials. Restore the old values or
  perform a planned restore into a fresh stack.
- `/api/v1/health` works but `/api/v1/ready` returns `503`: inspect the JSON component
  statuses and the `postgres` and `qdrant` logs. Readiness depends on both services.

## Rollback

If the new image failed before migrations changed the database, roll back the application:

```bash
git checkout <previous-tag>
docker compose build --pull
docker compose up -d
SMOKE_BASE_URL=http://localhost:8080 pnpm smoke:install
```

If the target release applied migrations and you must return to the previous release,
restore the pre-upgrade PostgreSQL dump before starting the old backend. Prisma migrations
are forward-only; do not assume an older backend can run safely against a newer schema.
Restore matching Qdrant and uploads backups when the failed upgrade accepted writes,
reindexed knowledge, or changed uploaded assets after the backup point.
