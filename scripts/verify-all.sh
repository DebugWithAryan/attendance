#!/bin/sh
# Full verification from an empty database, through the deployed code path.
#
#   sh scripts/verify-all.sh
#
# Needs Postgres reachable at $DATABASE_URL. Everything runs against
# scripts/vercel-sim.mjs, which serves api/index.js with VERCEL=1 set — the
# same entry point Vercel calls in production.
set -e

PORT=${SIM_PORT:-4001}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

: "${DATABASE_URL:?set DATABASE_URL first}"
export JWT_SECRET=${JWT_SECRET:-0123456789abcdef0123456789abcdef0123456789abcdef}

echo "--- schema"
node server/src/infra/db/migrate.js

echo "--- serverless entry on :$PORT"
PORT=$PORT node scripts/vercel-sim.mjs > /tmp/vercel-sim.log 2>&1 &
SIM=$!
trap 'kill $SIM 2>/dev/null' EXIT
sleep 3
curl -fsS "http://127.0.0.1:$PORT/api/health" || { cat /tmp/vercel-sim.log; exit 1; }
echo

# Before the seed, while the database is still empty: the first-run endpoint
# only exists in that state, and it creates the administrator the rest signs in
# as. It deliberately creates nothing else, so the seed below still runs.
echo "--- first-run suite (empty database)"
API_BASE="http://127.0.0.1:$PORT/api" node server/test/bootstrap.mjs

echo "--- seed"
node server/src/infra/db/seed.js

echo "--- API suite"
API_BASE="http://127.0.0.1:$PORT/api" node server/test/e2e.mjs

echo "--- UI suites"
cd web
npm run build:test --silent
API_ORIGIN="http://127.0.0.1:$PORT" node test/render.mjs
API_ORIGIN="http://127.0.0.1:$PORT" node test/interact.mjs
API_ORIGIN="http://127.0.0.1:$PORT" node test/journey.mjs

# Last, because it adds accounts and posts an event: the UI suites read the
# seeded department and a stray extra row is enough to move what they assert on.
echo "--- administrator suite"
cd "$ROOT"
API_BASE="http://127.0.0.1:$PORT/api" node server/test/admin.mjs

echo "--- all suites passed"
