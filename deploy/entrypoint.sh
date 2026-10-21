#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  node dist/src/db/migrate.js
fi

exec node dist/src/server.js
