#!/bin/sh
set -e

# Migrations run on release, before the process accepts traffic. `migrate
# deploy` applies what is already committed and never generates anything, so a
# container start cannot invent a schema change.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying migrations"
  npx prisma migrate deploy
fi

# Permissions and system roles are additive and idempotent, so they are safe to
# sync on every boot. A new permission added in code reaches the database here.
if [ "${SYNC_RBAC:-true}" = "true" ]; then
  echo "[entrypoint] syncing permissions and system roles"
  npx tsx scripts/sync-permissions.ts || echo "[entrypoint] rbac sync skipped"
fi

echo "[entrypoint] starting"
exec "$@"
