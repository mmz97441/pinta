#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_SUGGEST_DB_CONTAINER:-pinta-customs-suggestions-db}
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
if [ "${PINTA_KEEP_SUGGEST_DB:-0}" != 1 ]; then trap 'docker rm -fv "$container" > /dev/null 2>&1' EXIT;fi
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1)); if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do case ${migration##*/} in 202609*) ;; *) sql -1 < "$migration";; esac;done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/202609*.sql; do { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1;done
sql < "$root/tests/customs-suggestions.sql"
