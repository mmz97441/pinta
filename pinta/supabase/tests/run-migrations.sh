#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_DB_CONTAINER:-pinta-finalisation-db}
# The image briefly starts a Unix-socket-only server during initdb. Wait for
# TCP readiness so migrations run against the final server, including in CI.
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    printf 'PostgreSQL did not become ready within 30 seconds.\n' >&2
    docker logs "$container" >&2
    exit 1
  fi
  sleep 1
done
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < "$root/tests/bootstrap.sql"
for migration in "$root"/migrations/*.sql; do
  printf 'Applying %s\n' "${migration##*/}"
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -1 < "$migration"
done
