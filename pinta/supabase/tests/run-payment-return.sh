#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_PAYMENT_RETURN_DB_CONTAINER:-pinta-payment-return-db}
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then sql -1 < "$migration"; fi; done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then continue; fi
 case ${migration##*/} in 20260930000001_payment_return.sql)
  # Exercise the exact scoped deployment transaction, including fingerprints,
  # grants and rollback, without importing credentials or contacting a server.
  python3 -B -c "import sys;sys.path.insert(0,sys.argv[1]);import payment_return20260930 as release;print(release.transaction_sql())" "$root/../scripts/deployment" | sql
  sql -c "DO \$\$ BEGIN IF to_regprocedure('public.get_payment_return(text,uuid,uuid)') IS NOT NULL OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_intents' AND column_name LIKE 'return_token_%') THEN RAISE EXCEPTION 'Rehearsal rollback did not restore schema'; END IF; RAISE NOTICE 'PASS: exact deployment rehearsal preserves 17 tables and rolls back schema'; END; \$\$;"
 ;; esac
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1
done
sql < "$root/tests/payment-return.sql"
