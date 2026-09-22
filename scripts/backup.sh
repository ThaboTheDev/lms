#!/bin/sh
# Nightly database backup. Writes a compressed custom-format dump, keeps a
# checksum next to it, and removes anything past the retention window.
#
# This is the floor, not the ceiling: a real deployment should also stream WAL
# to object storage for point-in-time recovery. See docs/BACKUP.md.
set -eu

HOST="${PGHOST:-db}"
USER="${POSTGRES_USER:?POSTGRES_USER is required}"
DB="${POSTGRES_DB:-lms}"
DIR="${BACKUP_DIR:-/backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-35}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${DIR}/${DB}-${STAMP}.dump"

mkdir -p "$DIR"

echo "[backup] dumping ${DB} to ${FILE}"
pg_dump --host="$HOST" --username="$USER" --dbname="$DB" \
  --format=custom --compress=9 --file="$FILE"

# A dump nobody checked is a file, not a backup. The checksum is what the
# verification job compares against after a restore.
sha256sum "$FILE" > "${FILE}.sha256"

SIZE="$(wc -c < "$FILE")"
if [ "$SIZE" -lt 1024 ]; then
  echo "[backup] the dump is suspiciously small (${SIZE} bytes), keeping it but flagging" >&2
  exit 1
fi

echo "[backup] wrote ${SIZE} bytes"

echo "[backup] removing dumps older than ${RETENTION} days"
find "$DIR" -name "${DB}-*.dump*" -type f -mtime "+${RETENTION}" -delete

echo "[backup] done"
