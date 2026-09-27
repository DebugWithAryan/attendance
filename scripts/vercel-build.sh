#!/bin/sh
# Vercel's build step (vercel.json "buildCommand").
#
# A production build brings the database up to date before the new version goes
# live: Vercel only switches traffic to a deployment whose build passed, so if a
# migration fails the build fails and the site stays on the previous version.
# Every migration is written so the version still serving keeps working against
# the new schema (new tables, columns and triggers; a foreign key relaxed, never
# tightened), because it goes on serving until this build finishes.
#
# Preview builds never touch a database: a branch must not change production's
# schema before it is merged.
set -e

if [ "$VERCEL_ENV" = "production" ]; then
  # Migrations prefer the direct (unpooled) connection when Neon provides one.
  MIGRATION_URL="${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-$POSTGRES_URL}}"
  if [ -z "$MIGRATION_URL" ]; then
    echo "No DATABASE_URL in the production build environment, so the schema cannot be migrated." >&2
    echo "Add it for Production in Vercel (Settings > Environment Variables) and redeploy." >&2
    exit 1
  fi
  echo "--- migrating the production database"
  # The config insists on JWT_SECRET under NODE_ENV=production. Migrating signs
  # nothing, so the build does not depend on the secret being exposed to it.
  DATABASE_URL="$MIGRATION_URL" JWT_SECRET="${JWT_SECRET:-not-used-when-migrating}" \
    node server/src/infra/db/migrate.js
else
  echo "--- ${VERCEL_ENV:-local} build: database left alone"
fi

echo "--- building the web app"
# Vite is a dev dependency. NODE_ENV=production in the environment would make
# npm skip it, so ask for dev dependencies explicitly.
npm --prefix web install --include=dev --no-audit --no-fund
npm --prefix web run build
