#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
container=${PINTA_APPEND_DB_CONTAINER:-pinta-reception-append-db}
docker run --pull=never --rm --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine -c wal_level=logical > /dev/null
trap 'docker rm -fv "$container" > /dev/null 2>&1' EXIT
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1; do attempt=$((attempt+1));if [ "$attempt" -ge 30 ]; then exit 1; fi;sleep 1;done
sql() { docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -o /dev/null "$@"; }
sql < "$root/tests/bootstrap.sql"
sql -c 'CREATE ROLE supabase_admin SUPERUSER NOLOGIN;'
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then sql -1 < "$migration"; fi
done
sql -1 < "$root/tests/legacy-schema-fixture.sql"
for migration in "$root"/migrations/*.sql; do
 migration_name=${migration##*/}; if [ "${migration_name%%_*}" -lt 20260900000000 ]; then continue; fi
 case "$migration_name" in 20261001000001_reception_append.sql)
  python3 -B -c "import sys;sys.path.insert(0,sys.argv[1]);import reception_append20261001 as release;print(release.transaction_sql())" "$root/../scripts/deployment" | sql
  sql -c "DO \$\$ BEGIN IF to_regclass('public.reception_append_receipts') IS NOT NULL OR to_regprocedure('public.append_reception_cartons(uuid,jsonb,timestamptz,text,text,text[],uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Rehearsal rollback failed'; END IF;RAISE NOTICE 'PASS: exact release rehearsal preserves 17 tables and rolls back new objects'; END; \$\$;"
 ;; esac
 { printf 'SET ROLE supabase_admin;\n';cat "$migration"; } | sql -1
done
sql < "$root/tests/reception-append.sql"
sql < "$root/tests/task-readiness.sql"
sql < "$root/tests/reception-measurements.sql"
sql < "$root/tests/task-corrections.sql"
sql < "$root/tests/telegram-requested-invoice.sql"
PINTA_DB_CONTAINER="$container" node "$root/tests/customs-quote-parity.mjs"
sql < "$root/tests/reception-append-concurrency.sql"
logs=$(mktemp -d "${TMPDIR:-/tmp}/pinta-reception-race.XXXXXX")
trap 'docker rm -fv "$container" > /dev/null 2>&1; rm -rf "$logs"' EXIT
race() {
 docker exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$logs/$1.log" 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','eb100000-0000-4000-8000-000000000001',true);
SELECT append_reception_cartons(id,'[{"dimL":15,"dimW":20,"dimH":30,"poids":2}]',updated_at,NULL,NULL,NULL,'$3') FROM append_race_baseline WHERE id='$2';
SELECT pg_sleep(0.2);
COMMIT;
SQL
}
race first eb400000-0000-4000-8000-000000000001 eb700000-0000-4000-8000-000000000001 & first=$!
race second eb400000-0000-4000-8000-000000000001 eb700000-0000-4000-8000-000000000002 & second=$!
set +e
wait "$first"; first_status=$?
wait "$second"; second_status=$?
set -e
if ! { [ "$first_status" -eq 0 ] && [ "$second_status" -eq 3 ]; } && ! { [ "$first_status" -eq 3 ] && [ "$second_status" -eq 0 ]; }; then cat "$logs"/*.log; exit 1; fi
if ! grep -q '40001:' "$logs"/*.log; then cat "$logs"/*.log;exit 1;fi
race replay_first eb400000-0000-4000-8000-000000000002 eb700000-0000-4000-8000-000000000003 & first=$!
race replay_second eb400000-0000-4000-8000-000000000002 eb700000-0000-4000-8000-000000000003 & second=$!
wait "$first"
wait "$second"
sql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM colis WHERE id::text LIKE 'eb400000%' AND nb_colis=2)<>2
  OR (SELECT count(*) FROM reception_append_receipts WHERE colis_id::text LIKE 'eb400000%')<>2
  OR (SELECT count(*) FROM audit_actions WHERE colis_id::text LIKE 'eb400000%' AND action='reception_cartons_added')<>2
  OR EXISTS(SELECT 1 FROM notification_outbox WHERE colis_id::text LIKE 'eb400000%') THEN RAISE EXCEPTION 'Concurrent append changed unexpected rows or sent a message';END IF;
 RAISE NOTICE 'PASS: two different concurrent receipts commit once with explicit CAS conflict';
 RAISE NOTICE 'PASS: two identical concurrent requests both succeed with one physical addition and one audit';
END; $$;
SQL
