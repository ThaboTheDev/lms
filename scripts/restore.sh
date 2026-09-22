#!/bin/sh
# Restores a dump into a named database. Refuses to overwrite the live database
# unless told twice, because the moment you need this is the moment you are
# least careful.
#
#   ./scripts/restore.sh backups/lms-20260301T020000Z.dump lms_restore_check
set -eu

FILE="${1:?usage: restore.sh <dump file> <target database>}"
TARGET="${2:?usage: restore.sh <dump file> <target database>}"
HOST="${PGHOST:-db}"
USER="${POSTGRES_USER:?POSTGRES_USER is required}"
LIVE="${POSTGRES_DB:-lms}"

if [ "$TARGET" = "$LIVE" ] && [ "${I_MEAN_IT:-no}" != "yes" ]; then
  echo "Refusing to restore over the live database ${LIVE}." >&2
  echo "Restore to a scratch database first. If you really mean it, set I_MEAN_IT=yes." >&2
  exit 1
fi

if [ -f "${FILE}.sha256" ]; then
  echo "[restore] checking the dump against its checksum"
  (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256")
fi

echo "[restore] creating ${TARGET}"
createdb --host="$HOST" --username="$USER" "$TARGET" 2>/dev/null || true

echo "[restore] restoring"
pg_restore --host="$HOST" --username="$USER" --dbname="$TARGET" \
  --clean --if-exists --no-owner --no-privileges "$FILE"

echo "[restore] done. Verify it with scripts/verify-restore.sh ${TARGET}"
