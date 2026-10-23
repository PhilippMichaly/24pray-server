#!/bin/sh
# Container-Start: Migrationen, dann die API als PID 1 (exec), damit SIGTERM von
# docker/podman stop direkt bei Node ankommt (Graceful Shutdown in server.ts).
set -eu
# Dieselbe DB wie die App: server.ts baut die URL aus DATA_DIR, Prisma-CLI braucht
# DATABASE_URL. Ein explizit gesetztes DATABASE_URL gewinnt.
DATABASE_URL="${DATABASE_URL:-file:$(realpath -m "${DATA_DIR:-data}")/24pray.db}"
export DATABASE_URL
./node_modules/.bin/prisma migrate deploy
exec node dist/server.js
