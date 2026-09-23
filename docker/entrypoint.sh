#!/bin/sh
set -e

# Migrations run on release, before the process accepts traffic. `migrate
# deploy` applies what is already committed and never generates anything, so a
# container start cannot invent a schema change.
#
# In the compose stack this is off (RUN_MIGRATIONS=false): the one-shot
# `migrate` service owns the schema. If it is switched on inside the web
# image, fail loudly rather than half-work: the Next.js standalone build
# ships no Prisma CLI, so migrations belong to the migrate service.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  if [ ! -e node_modules/.bin/prisma ]; then
    echo "[entrypoint] node_modules/.bin/prisma is missing; migrations belong to the migrate service" >&2
    exit 1
  fi
  echo "[entrypoint] applying migrations"
  npx prisma migrate deploy
fi

# Permissions and system roles are additive and idempotent, so they are safe to
# sync on every boot. A new permission added in code reaches the database here.
# The standalone web image does not contain scripts/sync-permissions.ts: skip
# with a message instead of failing the boot.
if [ "${SYNC_RBAC:-true}" = "true" ]; then
  if [ ! -f scripts/sync-permissions.ts ]; then
    echo "[entrypoint] scripts/sync-permissions.ts is missing (standalone web image); skipping rbac sync"
  else
    echo "[entrypoint] syncing permissions and system roles"
    npx tsx scripts/sync-permissions.ts || echo "[entrypoint] rbac sync skipped"
  fi
fi

echo "[entrypoint] starting"
exec "$@"
