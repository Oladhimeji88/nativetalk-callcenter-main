#!/usr/bin/env bash
# Nightly PostgreSQL backup for the UCP platform.
# Usage: DATABASE_URL=postgres://... ./backup-db.sh [/backup/dir] [retention_days]
# Cron (2am daily):  0 2 * * *  DATABASE_URL=... /opt/ucp/deploy/backup-db.sh /var/backups/ucp 14
set -euo pipefail

DIR="${1:-/var/backups/ucp}"
RETENTION_DAYS="${2:-14}"
URL="${DATABASE_URL:?set DATABASE_URL}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${DIR}/ucp-${STAMP}.sql.gz"

mkdir -p "$DIR"
echo "Backing up to ${OUT} ..."
pg_dump "$URL" --no-owner --clean --if-exists | gzip > "$OUT"
echo "Done: $(du -h "$OUT" | cut -f1)"

# Prune old backups.
find "$DIR" -name 'ucp-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete
echo "Pruned backups older than ${RETENTION_DAYS} days."

# Restore (manual):  gunzip -c ucp-YYYYMMDD-HHMMSS.sql.gz | psql "$DATABASE_URL"
