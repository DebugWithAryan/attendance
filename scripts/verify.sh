#!/bin/sh
# Full clean verification cycle. Output goes to /tmp/cycle.log.
exec > /tmp/cycle.log 2>&1
set -x

pkill -f "node src/main.js"
sleep 1

su postgres -c "/usr/lib/postgresql/16/bin/psql -h /tmp -U postgres -d attendance -c 'drop schema public cascade; create schema public;'"

cd /home/claude/srv || exit 1
node src/infra/db/migrate.js
node src/infra/db/seed.js

setsid node src/main.js > /tmp/server.log 2>&1 < /dev/null &
sleep 4

node /home/claude/test.mjs
echo "EXIT=$?"
