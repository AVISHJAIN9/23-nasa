#!/bin/sh
set -e

if [ "$ASTRO_SEED_USERS_ON_START" = "true" ] || [ "$ASTRO_ENV" = "dev" ]; then
  echo "[AstroCare Entrypoint] Seeding dev users..."
  node dist/scripts/seedDevUsers.js || true
fi

exec "$@"
