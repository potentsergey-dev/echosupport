# Upgrade, Backup, and Restore

## Backup

Back up all three persistent data stores before upgrading:

```bash
docker compose exec -T postgres pg_dump -U echosupport echosupport > echosupport.sql
docker run --rm -v echosupport_qdrant_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/qdrant-data.tgz -C /data .
docker run --rm -v echosupport_uploads_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads.tgz -C /data .
```

Store `.env` and especially `MASTER_ENCRYPTION_KEY` separately and securely.

## Upgrade

```bash
git pull --ff-only
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 backend
```

The entrypoint runs `prisma migrate deploy` before starting the new backend.

## Rollback

Application rollback is `git checkout <previous-tag>` followed by a rebuild. Database
migrations are forward-only; restore the pre-upgrade PostgreSQL backup when a migration
cannot be safely retained. Test restore procedures before a production upgrade.
