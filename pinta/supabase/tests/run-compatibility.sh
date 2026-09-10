#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_DB_CONTAINER:-pinta-compat-db}
database=${PINTA_COMPAT_DATABASE:-pinta_legacy_schema_test}
# An exclusively local, disposable database; never takes a network connection URL.
# Fail if it already exists, preventing accidental replacement of any database.
docker exec "$container" createdb -U postgres "$database"
# Roles are cluster-wide and already created by run-migrations.sh in postgres.
sed '/^CREATE ROLE /d' "$root/tests/bootstrap.sql" | docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1
for migration in "$root"/migrations/*.sql; do
 case ${migration##*/} in
  202609*) ;;
  *) docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 -1 < "$migration" ;;
 esac
done
docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/202609*.sql; do
 printf 'Applying %s to synthetic historical schema\n' "${migration##*/}"
 docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 -1 < "$migration"
done
# The reconciliation must be safe to replay even after the new operational
# tables exist, with their own rows and constraints.
docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 -1 < "$root/migrations/20260909000000_reconcile_existing_schema.sql"
docker exec -i "$container" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 -1 < "$root/tests/legacy-schema-assertions.sql"
docker exec -i "$container" psql -q -U postgres -d "$database" -v ON_ERROR_STOP=1 < "$root/tests/regressions.sql" > /dev/null
