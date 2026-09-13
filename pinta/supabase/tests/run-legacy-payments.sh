#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_LEGACY_DB_CONTAINER:-pinta-legacy-payments-db}
# This test uses a cached image and has no network access or production connection.
docker run --pull=never --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do
 attempt=$((attempt + 1))
 if [ "$attempt" -ge 30 ]; then docker logs "$container" >&2; exit 1; fi
 sleep 1
done
sql() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -o /dev/null "$@"; }
sql < "$root/tests/bootstrap.sql"
for migration in "$root"/migrations/*.sql; do
 case "$migration" in *20260910000012_legacy_payplug_payments.sql) break;; esac
 sql -1 < "$migration"
done
sql -1 < "$root/tests/legacy-payments-fixtures.sql"
sql -1 < "$root/migrations/20260910000012_legacy_payplug_payments.sql"
after_legacy=false
for migration in "$root"/migrations/*.sql; do
 if [ "$after_legacy" = true ]; then sql -1 < "$migration"; fi
 case "$migration" in *20260910000012_legacy_payplug_payments.sql) after_legacy=true;; esac
done
sql < "$root/tests/payplug-mode.sql"
sql < "$root/tests/legacy-payments.sql"
