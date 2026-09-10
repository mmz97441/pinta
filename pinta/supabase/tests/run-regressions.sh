#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_DB_CONTAINER:-pinta-finalisation-db}
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -o /dev/null < "$root/tests/regressions.sql"
